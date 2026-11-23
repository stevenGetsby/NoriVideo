import { describe, expect, it } from 'vitest'
import {
  buildDayCsv,
  buildOverviewCsv,
  buildTriCsv,
  buildWeekCsv,
  csvCell,
  csvMoney,
} from '@/lib/compute-ledger/csv'
import type { DayReportRow, TriReportRow, WeekReportRow } from '@/lib/compute-ledger/aggregate'
import type { OverviewRow } from '@/lib/compute-ledger/overview'

const BOM = '﻿'

function dayRow(partial: Partial<DayReportRow> = {}): DayReportRow {
  return {
    dateKey: '2026-05-11',
    weekLabel: '5.11-5.17',
    projectId: 'p1',
    projectName: '聊斋',
    category: 'short',
    actorKey: 'u:song',
    actorName: '宋某',
    platformCny: 100,
    apiTokens: 12_799_434,
    apiTokenCny: 588.773964,
    jimengPoints: 583,
    jimengCny: 58.3,
    otherCny: 0,
    totalCny: 747.073964,
    remark: '',
    ...partial,
  }
}

function weekRow(partial: Partial<WeekReportRow> = {}): WeekReportRow {
  return {
    weekStart: '2026-05-18',
    weekLabel: '5.18-5.24',
    projectId: 'p1',
    projectName: '聊斋',
    category: 'short',
    totalCny: 230,
    people: [{ actorKey: 'u:song', actorName: '宋某', totalCny: 230 }],
    ...partial,
  }
}

function triRow(partial: Partial<TriReportRow> = {}): TriReportRow {
  return {
    bucketStart: '2026-05-10',
    bucketEnd: '2026-05-12',
    label: '2026-05-10 至 2026-05-12',
    projectId: 'p1',
    projectName: '聊斋',
    category: 'short',
    totalCny: 100,
    ...partial,
  }
}

function overviewRow(partial: Partial<OverviewRow> = {}): OverviewRow {
  return {
    projectId: 'p1',
    name: '聊斋',
    workId: 'w1',
    workState: 'active',
    duplicateName: false,
    category: 'short',
    status: 'in_progress',
    startDate: '2026-05-01',
    completedDate: null,
    targetDeliveryDate: null,
    elapsedDays: 11,
    durationMinutes: 10,
    costPerMinute: 74.7,
    totalEpisodes: 12,
    doneEpisodes: 6,
    completionRatio: 0.5,
    budgetCny: 1000,
    remainingCny: 253,
    usageRatio: 0.747,
    level: 'ok',
    totalCny: 747,
    periodCny: 747,
    platformCny: 100,
    externalCny: 647,
    byActor: [{ actorKey: 'u:song', name: '宋某', totalCny: 747, periodCny: 747 }],
    archived: false,
    note: null,
    ...partial,
  }
}

describe('csvCell formula-injection guard (R13)', () => {
  it('prefixes a single quote on strings starting with = + - @ tab or carriage return', () => {
    expect(csvCell("=cmd|' /C calc'!A0")).toBe("'=cmd|' /C calc'!A0")
    expect(csvCell('=1+1')).toBe("'=1+1")
    expect(csvCell('+1')).toBe("'+1")
    expect(csvCell('-1')).toBe("'-1")
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)")
    expect(csvCell('\tleading')).toBe("'\tleading")
    expect(csvCell('\rleading')).toBe(`"'\rleading"`)
  })

  it('does not prefix ordinary text or numbers', () => {
    expect(csvCell('聊斋')).toBe('聊斋')
    expect(csvCell('正常备注')).toBe('正常备注')
    expect(csvCell(123)).toBe('123')
    expect(csvCell(-5)).toBe('-5')
    expect(csvCell(0)).toBe('0')
  })

  it('renders null/undefined as an empty cell', () => {
    expect(csvCell(null)).toBe('')
  })

  it('quotes and escapes commas, double quotes and newlines', () => {
    expect(csvCell('a,b')).toBe('"a,b"')
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"')
    expect(csvCell('a,b "c"\nd')).toBe('"a,b ""c""\nd"')
  })

  it('prefixes then quotes when an injection string also needs quoting', () => {
    expect(csvCell('=a,b')).toBe('"\'=a,b"')
  })
})

describe('csvMoney never prefixes negative amounts', () => {
  it('formats to two decimals and keeps the minus sign bare', () => {
    expect(csvMoney(747.073964)).toBe('747.07')
    expect(csvMoney(-253)).toBe('-253.00')
    expect(csvMoney(0)).toBe('0.00')
    expect(csvMoney(100)).toBe('100.00')
  })
})

describe('CSV envelope: UTF-8 BOM + CRLF + trailing newline', () => {
  it('starts with BOM, joins rows with CRLF and ends with CRLF', () => {
    const csv = buildDayCsv([dayRow(), dayRow({ dateKey: '2026-05-12' })])
    expect(csv.startsWith(BOM)).toBe(true)
    expect(csv.endsWith('\r\n')).toBe(true)
    const body = csv.slice(BOM.length)
    expect(body.split('\r\n')).toHaveLength(4) // header + 2 rows + trailing empty
    expect(body.replace(/\r\n/g, '')).not.toContain('\n') // every newline is part of a CRLF pair
  })

  it('emits only the header for an empty result', () => {
    const csv = buildTriCsv([])
    expect(csv).toBe(`${BOM}每三天分组,项目名称,三日算力总消耗（元）\r\n`)
  })
})

describe('day CSV', () => {
  it('neutralizes an injection remark while keeping money columns bare', () => {
    const csv = buildDayCsv([dayRow({ remark: '=cmd|\' /C calc\'!A0', totalCny: -12.5, platformCny: -3 })])
    const lines = csv.slice(BOM.length).trimEnd().split('\r\n')
    expect(lines[0]).toContain('当天算力总消耗（元）')
    expect(lines[1]).toContain("'=cmd|' /C calc'!A0")
    expect(lines[1]).toContain('-12.50')
    expect(lines[1]).toContain('-3.00')
    expect(lines[1]).not.toContain("'-12.50")
  })

  it('writes Chinese category labels and the week label', () => {
    const csv = buildDayCsv([dayRow({ category: 'client_demo' })])
    expect(csv).toContain('甲方Demo')
    expect(csv).toContain('5.11-5.17')
  })
})

describe('week CSV', () => {
  it('expands one line per person and repeats the project total', () => {
    const csv = buildWeekCsv([weekRow({
      people: [
        { actorKey: 'u:song', actorName: '宋某', totalCny: 150 },
        { actorKey: 'u:qiu', actorName: '仇某', totalCny: 80 },
      ],
    })])
    const lines = csv.slice(BOM.length).trimEnd().split('\r\n')
    expect(lines).toHaveLength(3) // header + 2 people
    expect(lines[1]).toContain('宋某,150.00,230.00')
    expect(lines[2]).toContain('仇某,80.00,230.00')
  })
})

describe('tri CSV', () => {
  it('writes the bucket label and project total', () => {
    const csv = buildTriCsv([triRow({ totalCny: 300 })])
    expect(csv).toContain('2026-05-10 至 2026-05-12,聊斋,300.00')
  })
})

describe('overview CSV', () => {
  it('renders budget, ratio percent, per-minute and the actor detail string', () => {
    const csv = buildOverviewCsv([overviewRow()])
    const line = csv.slice(BOM.length).trimEnd().split('\r\n')[1]
    expect(line).toContain('747.00')
    expect(line).toContain('1000.00')
    expect(line).toContain('253.00')
    expect(line).toContain('74.70%')
    expect(line).toContain('74.70')
    expect(line).toContain('宋某 747.00')
    expect(line).toContain('进行中')
  })

  it('leaves optional numeric columns empty when null', () => {
    const csv = buildOverviewCsv([overviewRow({
      budgetCny: null,
      remainingCny: null,
      usageRatio: null,
      durationMinutes: null,
      costPerMinute: null,
      totalEpisodes: null,
      doneEpisodes: null,
      startDate: null,
      category: null,
    })])
    const line = csv.slice(BOM.length).trimEnd().split('\r\n')[1]
    expect(line.startsWith('聊斋,,')).toBe(true)
  })

  it('neutralizes an injection project name and joins multiple actors with ；', () => {
    const csv = buildOverviewCsv([overviewRow({
      name: '=HYPERLINK("x")',
      byActor: [
        { actorKey: 'u:song', name: '宋某', totalCny: 700, periodCny: 700 },
        { actorKey: 'u:qiu', name: '仇某', totalCny: 47, periodCny: 47 },
      ],
    })])
    expect(csv).toContain('"\'=HYPERLINK(""x"")"')
    expect(csv).toContain('宋某 700.00；仇某 47.00')
  })
})
