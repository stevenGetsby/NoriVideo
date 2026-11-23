import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  CARRY_FORWARD_DATE_KEY,
  buildImportPlan,
  type ImportData,
  type ImportPayload,
  type ImportRow,
} from '@/lib/compute-ledger/import-plan'
import { toMicros } from '@/lib/compute-ledger/calc'

const OWNER = 'owner-1'

function emptyData(partial: Partial<ImportData> = {}): ImportData {
  return {
    existingProjects: [],
    works: [],
    linkedWorkIds: [],
    accounts: [
      { id: 'u-jia', name: '甲' },
      { id: 'u-yi', name: '乙' },
    ],
    existingImportKeys: [],
    platformFacts: [],
    ...partial,
  }
}

function row(partial: Partial<ImportRow> & { rowNo: number }): ImportRow {
  return {
    dateKey: '2026-05-11',
    projectName: 'P',
    actorName: '甲',
    apiTokens: 0,
    jimengPoints: 0,
    ...partial,
  }
}

function payload(rows: ImportRow[], statedProjectTotals?: Record<string, number>): ImportPayload {
  return { rows, statedProjectTotals }
}

const none = { carryForward: 'none' } as const
const stated = { carryForward: 'stated-total' } as const

describe('buildImportPlan amount math (46 / 0.1 fixed import rates)', () => {
  const rows = [
    row({ rowNo: 1, apiTokens: 1_000_000 }),
    row({ rowNo: 2, jimengPoints: 100 }),
    row({ rowNo: 3, dateKey: '2026-05-12', actorName: '乙', apiTokens: 2_000_000, jimengPoints: 50 }),
    row({ rowNo: 4, dateKey: '2026-05-13' }),
  ]

  it('splits token and jimeng into separate entries and skips all-zero rows', () => {
    const plan = buildImportPlan(OWNER, payload(rows), none, emptyData())
    expect(plan.report.summary.rows).toBe(4)
    expect(plan.report.summary.emptyRows).toBe(1)
    expect(plan.report.summary.entriesToCreate).toBe(4)
    expect(plan.report.summary.importedCny).toBe(153) // 46 + 10 + 92 + 5
    expect(plan.entries.map((e) => [e.kind, e.amountCny])).toEqual([
      ['api_token', 46],
      ['jimeng_points', 10],
      ['api_token', 92],
      ['jimeng_points', 5],
    ])
    expect(plan.report.summary.actorsMatched).toBe(2)
    expect(plan.report.summary.actorsUnmatched).toBe(0)
    expect(plan.report.summary.projectsNew).toBe(1)
  })

  it('matches actors by NFKC name and leaves unmatched actors with a null userId', () => {
    const plan = buildImportPlan(OWNER, payload([
      row({ rowNo: 1, apiTokens: 1_000_000 }),
      row({ rowNo: 2, actorName: '陌生人', apiTokens: 1_000_000 }),
    ]), none, emptyData())
    expect(plan.report.summary.actorsMatched).toBe(1)
    expect(plan.report.summary.actorsUnmatched).toBe(1)
    const matched = plan.entries.find((e) => e.actorLabel === '甲')
    const unmatched = plan.entries.find((e) => e.actorLabel === '陌生人')
    expect(matched?.actorUserId).toBe('u-jia')
    expect(unmatched?.actorUserId).toBeNull()
  })
})

describe('importKey determinism and reportHash', () => {
  const rows = [row({ rowNo: 1, apiTokens: 1_000_000 })]

  it('produces identical importKeys across repeated runs', () => {
    const a = buildImportPlan(OWNER, payload(rows), none, emptyData())
    const b = buildImportPlan(OWNER, payload(rows), none, emptyData())
    expect(a.entries.map((e) => e.importKey)).toEqual(b.entries.map((e) => e.importKey))
    expect(a.entries[0].importKey.startsWith('imp1:')).toBe(true)
    expect(a.report.reportHash).toBe(b.report.reportHash)
  })

  it('changes reportHash when the carryForward option changes', () => {
    const a = buildImportPlan(OWNER, payload(rows, { P: 200 }), none, emptyData())
    const b = buildImportPlan(OWNER, payload(rows, { P: 200 }), stated, emptyData())
    expect(a.report.reportHash).not.toBe(b.report.reportHash)
  })

  it('changes reportHash when the owner changes (keys are owner-scoped)', () => {
    const a = buildImportPlan(OWNER, payload(rows), none, emptyData())
    const b = buildImportPlan('owner-2', payload(rows), none, emptyData())
    expect(a.entries[0].importKey).not.toBe(b.entries[0].importKey)
  })
})

describe('carry-forward (option B) threshold and amount', () => {
  const rows = [row({ rowNo: 1, apiTokens: 1_000_000 })] // imported 46 CNY

  it('creates a 2020-01-01 other_cny entry for the stated-total gap above 0.05', () => {
    const plan = buildImportPlan(OWNER, payload(rows, { P: 200 }), stated, emptyData())
    const carry = plan.entries.find((e) => e.dateKey === CARRY_FORWARD_DATE_KEY)
    expect(carry).toBeTruthy()
    expect(carry?.kind).toBe('other_cny')
    expect(carry?.quantity).toBe(154)
    expect(carry?.amountCny).toBe(154)
    expect(carry?.actorLabel).toBe('期初结转')
    expect(plan.report.summary.carryForwardCny).toBe(154)
    expect(plan.report.summary.entriesToCreate).toBe(2)
  })

  it('does not create a carry entry when the gap is at or below 0.05', () => {
    const plan = buildImportPlan(OWNER, payload(rows, { P: 46.05 }), stated, emptyData())
    expect(plan.entries.some((e) => e.dateKey === CARRY_FORWARD_DATE_KEY)).toBe(false)
    expect(plan.report.summary.carryForwardCny).toBe(0)
  })

  it('creates a carry entry just above the threshold', () => {
    const plan = buildImportPlan(OWNER, payload(rows, { P: 46.06 }), stated, emptyData())
    const carry = plan.entries.find((e) => e.dateKey === CARRY_FORWARD_DATE_KEY)
    expect(carry?.quantity).toBe(0.06)
  })

  it('never carries when the option is none', () => {
    const plan = buildImportPlan(OWNER, payload(rows, { P: 200 }), none, emptyData())
    expect(plan.entries.some((e) => e.dateKey === CARRY_FORWARD_DATE_KEY)).toBe(false)
  })
})

describe('deduplication and idempotency', () => {
  it('flags an in-file duplicate import key as an error and creates only one entry', () => {
    const plan = buildImportPlan(OWNER, payload([
      row({ rowNo: 1, apiTokens: 1_000_000 }),
      row({ rowNo: 2, apiTokens: 1_000_000 }),
    ]), none, emptyData())
    expect(plan.report.summary.entriesToCreate).toBe(1)
    expect(plan.report.errors.some((e) => e.rowNo === 2 && e.reason.includes('导入键重复'))).toBe(true)
  })

  it('counts an already-imported key as alreadyImported and skips re-creating it', () => {
    const first = buildImportPlan(OWNER, payload([row({ rowNo: 1, apiTokens: 1_000_000 })]), none, emptyData())
    const key = first.entries[0].importKey
    const second = buildImportPlan(OWNER, payload([row({ rowNo: 1, apiTokens: 1_000_000 })]), none, emptyData({ existingImportKeys: [key] }))
    expect(second.report.summary.alreadyImported).toBe(1)
    expect(second.report.summary.entriesToCreate).toBe(0)
    expect(second.entries).toHaveLength(0)
  })
})

describe('project matching, work linking and overlap detection', () => {
  it('reuses an existing non-archived project by normalized name key', () => {
    const data = emptyData({
      existingProjects: [{
        id: 'lp1', nameKey: 'p', workId: null, archivedAt: null, category: null,
        budgetCny: null, startDate: null, targetDeliveryDate: null, totalEpisodes: null, doneEpisodes: null,
      }],
    })
    const plan = buildImportPlan(OWNER, payload([row({ rowNo: 1, apiTokens: 1_000_000 })]), none, data)
    expect(plan.report.summary.projectsMatched).toBe(1)
    expect(plan.report.summary.projectsNew).toBe(0)
    expect(plan.projects[0].action).toBe('reuse')
    expect(plan.projects[0].existingId).toBe('lp1')
  })

  it('links a single same-named work and reports a platform/import date overlap', () => {
    const data = emptyData({
      works: [{ id: 'w1', name: 'W' }],
      platformFacts: [{ workId: 'w1', dateKey: '2026-05-14', costMicros: toMicros(10) }],
    })
    const plan = buildImportPlan(OWNER, payload([
      row({ rowNo: 1, dateKey: '2026-05-14', projectName: 'W', apiTokens: 1_000_000 }),
    ]), none, data)
    expect(plan.projects[0].workId).toBe('w1')
    expect(plan.report.summary.projectsLinkedToWork).toBe(1)
    expect(plan.report.overlaps).toHaveLength(1)
    expect(plan.report.overlaps[0]).toMatchObject({ project: 'W', from: '2026-05-14', to: '2026-05-14', platformCny: 10, importedCny: 46 })
  })

  it('builds an external project and warns when a name matches multiple works', () => {
    const data = emptyData({ works: [{ id: 'w1', name: 'W' }, { id: 'w2', name: 'W' }] })
    const plan = buildImportPlan(OWNER, payload([
      row({ rowNo: 1, projectName: 'W', apiTokens: 1_000_000 }),
    ]), none, data)
    expect(plan.projects[0].workId).toBeNull()
    expect(plan.report.warnings.some((w) => w.includes('同名作品'))).toBe(true)
  })
})

describe('row validation errors', () => {
  it('rejects invalid dates, future dates, empty names and negative quantities', () => {
    const plan = buildImportPlan(OWNER, payload([
      row({ rowNo: 1, dateKey: '2026-02-30', apiTokens: 1_000_000 }),
      row({ rowNo: 2, dateKey: '2999-01-01', apiTokens: 1_000_000 }),
      row({ rowNo: 3, projectName: '', apiTokens: 1_000_000 }),
      row({ rowNo: 4, actorName: '', apiTokens: 1_000_000 }),
      row({ rowNo: 5, apiTokens: -5 }),
      row({ rowNo: 6, jimengPoints: -1 }),
    ]), none, emptyData())
    expect(plan.report.errors.map((e) => e.rowNo).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6])
    expect(plan.report.summary.entriesToCreate).toBe(0)
  })
})

describe('synthetic fixture end-to-end plan', () => {
  const fixture = JSON.parse(
    readFileSync(new URL('../../fixtures/compute-ledger/sample-rows.json', import.meta.url), 'utf8'),
  ) as ImportPayload

  const data = emptyData({
    works: [{ id: 'w-same', name: '同名作品' }],
    accounts: [
      { id: 'u-jia', name: '测试甲' },
      { id: 'u-yi', name: '测试乙' },
    ],
    platformFacts: [{ workId: 'w-same', dateKey: '2026-05-14', costMicros: toMicros(10) }],
  })

  it('plans the whole synthetic sheet without throwing and surfaces every dirty-row case', () => {
    const plan = buildImportPlan(OWNER, fixture, stated, data)
    expect(plan.report.summary.rows).toBe(14)
    expect(plan.report.summary.emptyRows).toBe(1)
    const errorRows = plan.report.errors.map((e) => e.rowNo)
    expect(errorRows).toContain(9) // invalid date
    expect(errorRows).toContain(11) // in-file duplicate key
    expect(errorRows).toContain(13) // negative token
    expect(errorRows).toContain(14) // empty project name
    expect(plan.report.summary.actorsUnmatched).toBeGreaterThanOrEqual(1) // 外来人员
    expect(plan.report.summary.projectsLinkedToWork).toBeGreaterThanOrEqual(1) // 同名作品
    expect(plan.report.overlaps.length).toBeGreaterThanOrEqual(1)
    expect(plan.report.warnings.some((w) => w.includes('首尾空格'))).toBe(true)
    expect(plan.report.warnings.some((w) => w.includes('无法识别'))).toBe(true)
    expect(plan.report.summary.carryForwardCny).toBeGreaterThan(0)
    // every planned entry carries a stable, owner-scoped key
    expect(plan.entries.every((e) => e.importKey.startsWith('imp1:'))).toBe(true)
  })

  it('is deterministic for the fixture across runs', () => {
    const a = buildImportPlan(OWNER, fixture, stated, data)
    const b = buildImportPlan(OWNER, fixture, stated, data)
    expect(a.report.reportHash).toBe(b.report.reportHash)
    expect(a.entries.map((e) => e.importKey)).toEqual(b.entries.map((e) => e.importKey))
  })
})
