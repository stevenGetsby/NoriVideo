import { describe, expect, it } from 'vitest'
import {
  ALL_GENERATION_TASK_TYPES,
  buildActivityCsv,
  emptyMediaCounts,
  formatKeepRate,
  keepRate,
  mediaKindForMaterialType,
  mediaKindForTaskType,
  parseActivityRange,
  resolveActivityWindow,
  resolveTrendWindow,
  shanghaiDateKey,
  shanghaiHour,
  summarizeRows,
  type ActivityOverview,
  type ActivityRow,
} from '@/lib/account/activity-stats-shared'

function row(overrides: Partial<ActivityRow> = {}): ActivityRow {
  return {
    userId: 'u1',
    name: '小明',
    roleLabel: null,
    status: 'active',
    lastLoginAt: '2026-11-10T16:30:00.000Z',
    lastOutputAt: '2026-11-11T02:05:00.000Z',
    generated: { image: 3, video: 1, audio: 0, total: 4 },
    uploaded: { image: 2, video: 0, audio: 1, total: 3 },
    uploadedUnique: 2,
    failed: 1,
    retried: 2,
    points: 12.5,
    producedAssets: 4,
    keptAssets: 3,
    ...overrides,
  }
}

describe('activity range windows', () => {
  // 2026-11-11 02:30 UTC == 2026-11-11 10:30 Shanghai
  const now = new Date('2026-11-11T02:30:00.000Z')

  it('uses the Shanghai natural day for today', () => {
    const window = resolveActivityWindow('today', now)
    expect(window.from.toISOString()).toBe('2026-11-10T16:00:00.000Z')
    expect(window.to.toISOString()).toBe('2026-11-11T16:00:00.000Z')
  })

  it('treats 16:30 UTC as already being the next Shanghai day', () => {
    const late = new Date('2026-11-11T16:30:00.000Z')
    expect(resolveActivityWindow('today', late).from.toISOString()).toBe('2026-11-11T16:00:00.000Z')
    expect(shanghaiDateKey(late)).toBe('2026-11-12')
    expect(shanghaiHour(late)).toBe(0)
  })

  it('includes today in 7d and 30d windows', () => {
    const week = resolveActivityWindow('7d', now)
    expect(week.days).toBe(7)
    expect(week.from.toISOString()).toBe('2026-11-04T16:00:00.000Z')
    expect(week.to.toISOString()).toBe('2026-11-11T16:00:00.000Z')
    const month = resolveActivityWindow('30d', now)
    expect(month.to.getTime() - month.from.getTime()).toBe(30 * 24 * 3600 * 1000)
  })

  it('builds a 14 day trend window ending today', () => {
    const trend = resolveTrendWindow(now)
    expect(trend.dates).toHaveLength(14)
    expect(trend.dates[0]).toBe('2026-10-29')
    expect(trend.dates[13]).toBe('2026-11-11')
  })

  it('parses ranges strictly and defaults to today', () => {
    expect(parseActivityRange(null)).toBe('today')
    expect(parseActivityRange('')).toBe('today')
    expect(parseActivityRange('7d')).toBe('7d')
    expect(parseActivityRange('90d')).toBeNull()
  })
})

describe('activity classification', () => {
  it('maps generation task types to media kinds and ignores text tasks', () => {
    expect(mediaKindForTaskType('toolbox_image')).toBe('image')
    expect(mediaKindForTaskType('canvas_video_operation')).toBe('video')
    expect(mediaKindForTaskType('toolbox_audio')).toBe('audio')
    expect(mediaKindForTaskType('canvas_text_generation')).toBeNull()
    expect(ALL_GENERATION_TASK_TYPES).not.toContain('canvas_text_generation')
    expect(new Set(ALL_GENERATION_TASK_TYPES).size).toBe(ALL_GENERATION_TASK_TYPES.length)
  })

  it('only buckets plain media material types', () => {
    expect(mediaKindForMaterialType('image')).toBe('image')
    expect(mediaKindForMaterialType('model3d')).toBeNull()
  })
})

describe('activity summary and keep rate', () => {
  it('sums rows without merging generation and upload', () => {
    const summary = summarizeRows([row(), row({ userId: 'u2', points: 0.1 + 0.2 })])
    expect(summary.accounts).toBe(2)
    expect(summary.generated.total).toBe(8)
    expect(summary.uploaded.total).toBe(6)
    expect(summary.points).toBe(12.8)
    expect(summary.failed).toBe(2)
  })

  it('returns null keep rate when nothing was produced', () => {
    expect(keepRate({ producedAssets: 0, keptAssets: 0 })).toBeNull()
    expect(formatKeepRate(null)).toBe('—')
    expect(formatKeepRate(keepRate({ producedAssets: 4, keptAssets: 3 }))).toBe('75%')
    expect(summarizeRows([]).generated).toEqual(emptyMediaCounts())
  })
})

describe('activity csv', () => {
  const overview = (rows: ActivityRow[]): ActivityOverview => ({
    range: 'today',
    timeZone: 'Asia/Shanghai',
    from: '2026-11-10T16:00:00.000Z',
    to: '2026-11-11T16:00:00.000Z',
    generatedAt: '2026-11-11T02:30:00.000Z',
    summary: summarizeRows(rows),
    rows,
  })

  it('writes a BOM, header, Shanghai times and kept ratio', () => {
    const csv = buildActivityCsv(overview([row()]))
    expect(csv.startsWith('﻿')).toBe(true)
    const lines = csv.trim().split('\r\n')
    expect(lines[0]).toContain('今天')
    expect(lines[0]).toContain('2026-11-11 00:00')
    expect(lines[1].split(',')[0]).toBe('账号')
    expect(lines[2]).toBe('小明,正常,2026-11-11 00:30,2026-11-11 10:05,3,1,0,4,2,0,1,3,2,12.5,1,2,75%')
  })

  it('quotes commas/quotes and neutralises spreadsheet formulas in names', () => {
    const csv = buildActivityCsv(overview([row({ name: '=HYPERLINK("x")' }), row({ name: 'a,b' })]))
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`)
    expect(csv).toContain('"a,b"')
  })

  it('marks disabled accounts and leaves empty times blank', () => {
    const csv = buildActivityCsv(overview([row({ status: 'disabled', lastLoginAt: null, lastOutputAt: null, producedAssets: 0, keptAssets: 0 })]))
    expect(csv).toContain('停用,,,')
    expect(csv.trim().endsWith('—')).toBe(true)
  })
})
