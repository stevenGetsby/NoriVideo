import { describe, expect, it } from 'vitest'
import {
  type LedgerCell,
  type ProjectMeta,
  buildDayReport,
  buildLedgerCells,
  buildTriReport,
  buildWeekReport,
  cellTotalMicros,
} from '@/lib/compute-ledger/aggregate'
import { toMicros } from '@/lib/compute-ledger/calc'

const projects = new Map<string, ProjectMeta>([
  ['p1', { name: '聊斋', category: 'short' }],
  ['p2', { name: '样片', category: null }],
])

describe('buildLedgerCells merges facts and entries by shared actor key', () => {
  it('combines platform + token + jimeng for the same u: key and dedupes remarks', () => {
    const cells = buildLedgerCells(
      [{ dateKey: '2026-05-11', projectId: 'p1', actorKey: 'u:song', actorName: '宋国傲', costMicros: toMicros(100) }],
      [
        { dateKey: '2026-05-11', projectId: 'p1', actorKey: 'u:song', actorName: '宋国傲', kind: 'api_token', quantity: 12_799_434, amountMicros: 588_773_964, remark: 'r1' },
        { dateKey: '2026-05-11', projectId: 'p1', actorKey: 'u:song', actorName: '宋国傲', kind: 'jimeng_points', quantity: 583, amountMicros: 58_300_000, remark: 'r1' },
      ],
    )
    expect(cells).toHaveLength(1)
    const cell = cells[0]
    expect(cell.platformMicros).toBe(toMicros(100))
    expect(cell.tokenMicros).toBe(588_773_964)
    expect(cell.jimengMicros).toBe(58_300_000)
    expect(cell.tokenQty).toBe(12_799_434)
    expect(cell.jimengQty).toBe(583)
    expect(cell.remarks).toEqual(['r1'])
    expect(cellTotalMicros(cell)).toBe(toMicros(100) + 588_773_964 + 58_300_000)
  })

  it('keeps an unmatched l: actor separate from a u: actor', () => {
    const cells = buildLedgerCells(
      [],
      [
        { dateKey: '2026-05-11', projectId: 'p1', actorKey: 'u:song', actorName: '宋国傲', kind: 'other_cny', quantity: 10, amountMicros: toMicros(10) },
        { dateKey: '2026-05-11', projectId: 'p1', actorKey: 'l:期初结转', actorName: '期初结转', kind: 'other_cny', quantity: 50, amountMicros: toMicros(50) },
      ],
    )
    expect(cells).toHaveLength(2)
    expect(cells.map((c) => c.actorKey).sort()).toEqual(['l:期初结转', 'u:song'])
  })

  it('drops zero-total cells (days with no spend produce no row)', () => {
    const cells = buildLedgerCells(
      [{ dateKey: '2026-05-11', projectId: 'p1', actorKey: 'u:song', actorName: '宋国傲', costMicros: 0 }],
      [],
    )
    expect(cells).toHaveLength(0)
  })
})

function cell(partial: Partial<LedgerCell> & { dateKey: string; projectId: string; actorKey: string; actorName: string }): LedgerCell {
  return {
    platformMicros: 0, tokenQty: 0, tokenMicros: 0, jimengQty: 0, jimengMicros: 0, otherMicros: 0, remarks: [],
    ...partial,
  }
}

describe('day report', () => {
  it('sorts dateKey desc then project then actor, footer sums the whole result', () => {
    const cells = [
      cell({ dateKey: '2026-05-11', projectId: 'p1', actorKey: 'u:song', actorName: '宋国傲', platformMicros: toMicros(100), tokenMicros: 588_773_964, jimengMicros: 58_300_000, tokenQty: 12_799_434, jimengQty: 583, remarks: ['和婚介拆账'] }),
      cell({ dateKey: '2026-05-12', projectId: 'p2', actorKey: 'u:wu', actorName: '武晓乐', otherMicros: toMicros(20) }),
    ]
    const { rows, footer } = buildDayReport(cells, projects)
    expect(rows[0].dateKey).toBe('2026-05-12')
    expect(rows[1].dateKey).toBe('2026-05-11')
    expect(rows[1].weekLabel).toBe('5.11-5.17')
    expect(rows[1].projectName).toBe('聊斋')
    expect(rows[1].category).toBe('short')
    expect(rows[1].apiTokens).toBe(12_799_434)
    expect(rows[1].remark).toBe('和婚介拆账')
    expect(footer.totalCny).toBeCloseTo((toMicros(100) + 588_773_964 + 58_300_000 + toMicros(20)) / 1e6, 6)
  })
})

describe('week report', () => {
  it('groups by Monday-week + project and breaks down people', () => {
    const cells = [
      cell({ dateKey: '2026-05-18', projectId: 'p1', actorKey: 'u:song', actorName: '宋国傲', platformMicros: toMicros(100) }),
      cell({ dateKey: '2026-05-20', projectId: 'p1', actorKey: 'u:song', actorName: '宋国傲', platformMicros: toMicros(50) }),
      cell({ dateKey: '2026-05-18', projectId: 'p1', actorKey: 'u:qiu', actorName: '仇殿华', platformMicros: toMicros(80) }),
      cell({ dateKey: '2026-05-25', projectId: 'p1', actorKey: 'u:song', actorName: '宋国傲', platformMicros: toMicros(10) }),
    ]
    const { rows, footer } = buildWeekReport(cells, projects)
    expect(rows).toHaveLength(2)
    expect(rows[0].weekStart).toBe('2026-05-25')
    expect(rows[1].weekStart).toBe('2026-05-18')
    expect(rows[1].weekLabel).toBe('5.18-5.24')
    expect(rows[1].totalCny).toBe(230)
    expect(rows[1].people[0]).toMatchObject({ actorName: '宋国傲', totalCny: 150 })
    expect(rows[1].people[1]).toMatchObject({ actorName: '仇殿华', totalCny: 80 })
    expect(footer.totalCny).toBe(240)
  })
})

describe('tri report', () => {
  it('groups by day-of-month tri bucket + project', () => {
    const cells = [
      cell({ dateKey: '2026-05-07', projectId: 'p1', actorKey: 'u:song', actorName: '宋国傲', jimengMicros: toMicros(291.2), jimengQty: 2912 }),
      cell({ dateKey: '2026-05-09', projectId: 'p1', actorKey: 'u:qiu', actorName: '仇殿华', platformMicros: toMicros(8.8) }),
      cell({ dateKey: '2026-05-11', projectId: 'p1', actorKey: 'u:song', actorName: '宋国傲', platformMicros: toMicros(100) }),
    ]
    const { rows, footer } = buildTriReport(cells, projects)
    expect(rows).toHaveLength(2)
    expect(rows[0].label).toBe('2026-05-10 至 2026-05-12')
    expect(rows[0].totalCny).toBe(100)
    expect(rows[1].label).toBe('2026-05-07 至 2026-05-09')
    expect(rows[1].totalCny).toBe(300)
    expect(footer.totalCny).toBe(400)
  })
})