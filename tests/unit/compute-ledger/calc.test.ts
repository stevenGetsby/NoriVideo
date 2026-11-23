import { describe, expect, it } from 'vitest'
import {
  BUDGET_WARN_RATIO,
  actorKey,
  addDaysKey,
  budgetState,
  completionRatio,
  computeEntryAmountMicros,
  costPerMinute,
  daysBetweenKeys,
  elapsedDays,
  fromMicros,
  isValidDateKey,
  normalizeCategory,
  normalizeProjectName,
  toCents,
  toMicros,
  triBucket,
  weekLabel,
  weekStartKey,
} from '@/lib/compute-ledger/calc'

describe('compute-ledger calc: money in integer micros', () => {
  it('converts the xlsx 聊斋 5.11 row exactly (12,799,434 token × 46 + 583 积分 × 0.1)', () => {
    const tokenMicros = computeEntryAmountMicros('api_token', 12_799_434, 46)
    const jimengMicros = computeEntryAmountMicros('jimeng_points', 583, 0.1)
    expect(tokenMicros).toBe(588_773_964)
    expect(jimengMicros).toBe(58_300_000)
    expect(fromMicros(tokenMicros)).toBeCloseTo(588.773964, 6)
    expect(toCents(tokenMicros + jimengMicros)).toBe(647.07)
  })

  it('other_cny treats quantity as yuan with rate 1', () => {
    expect(computeEntryAmountMicros('other_cny', 291.2, 1)).toBe(291_200_000)
  })

  it('adds 0.1 + 0.2 exactly through micros (no float drift)', () => {
    const sum = toMicros(0.1) + toMicros(0.2)
    expect(fromMicros(sum)).toBe(0.3)
  })

  it('toCents only rounds for display', () => {
    expect(toCents(588_773_964)).toBe(588.77)
    expect(toCents(1)).toBe(0)
    expect(toCents(5_000)).toBe(0.01)
  })
})

describe('compute-ledger calc: date keys', () => {
  it('addDaysKey / daysBetweenKeys cross month and year boundaries', () => {
    expect(addDaysKey('2026-05-31', 1)).toBe('2026-06-01')
    expect(addDaysKey('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDaysKey('2026-06-01', -1)).toBe('2026-05-31')
    expect(daysBetweenKeys('2026-05-07', '2026-06-22')).toBe(46)
  })

  it('isValidDateKey rejects impossible and malformed dates', () => {
    expect(isValidDateKey('2026-05-07')).toBe(true)
    expect(isValidDateKey('2026-02-30')).toBe(false)
    expect(isValidDateKey('2026-13-01')).toBe(false)
    expect(isValidDateKey('2026-5-7')).toBe(false)
    expect(isValidDateKey('2028-02-29')).toBe(true)
    expect(isValidDateKey('2026-02-29')).toBe(false)
  })

  it('triBucket matches the real xlsx group labels', () => {
    expect(triBucket('2026-05-07').label).toBe('2026-05-07 至 2026-05-09')
    expect(triBucket('2026-05-11').label).toBe('2026-05-10 至 2026-05-12')
    expect(triBucket('2026-05-18').label).toBe('2026-05-16 至 2026-05-18')
    expect(triBucket('2026-05-26').label).toBe('2026-05-25 至 2026-05-27')
    expect(triBucket('2026-06-01').label).toBe('2026-06-01 至 2026-06-03')
    expect(triBucket('2026-06-21').label).toBe('2026-06-19 至 2026-06-21')
    expect(triBucket('2026-05-31').label).toBe('2026-05-31 至 2026-05-31')
    expect(triBucket('2026-02-28').label).toBe('2026-02-28 至 2026-02-28')
    expect(triBucket('2028-02-29').label).toBe('2028-02-28 至 2028-02-29')
  })

  it('weekStartKey / weekLabel start on Monday and cross month/year', () => {
    expect(weekLabel(weekStartKey('2026-05-18'))).toBe('5.18-5.24')
    expect(weekStartKey('2026-05-24')).toBe('2026-05-18')
    expect(weekLabel(weekStartKey('2026-06-22'))).toBe('6.22-6.28')
    expect(weekLabel(weekStartKey('2026-06-29'))).toBe('6.29-7.5')
    expect(weekLabel(weekStartKey('2026-12-28'))).toBe('12.28-1.3')
  })
})

describe('compute-ledger calc: budget levels', () => {
  it('uses 0.8 warn and 1.0 over thresholds', () => {
    expect(BUDGET_WARN_RATIO).toBe(0.8)
    expect(budgetState(100, toMicros(79.99)).level).toBe('ok')
    expect(budgetState(100, toMicros(80)).level).toBe('warn')
    expect(budgetState(100, toMicros(99.99)).level).toBe('warn')
    expect(budgetState(100, toMicros(100)).level).toBe('over')
    expect(budgetState(100, toMicros(120)).remainingCny).toBe(-20)
  })

  it('null or non-positive budget means none', () => {
    expect(budgetState(null, 1_000_000).level).toBe('none')
    expect(budgetState(0, 1_000_000).level).toBe('none')
    expect(budgetState(null, 0).ratio).toBeNull()
  })
})

describe('compute-ledger calc: derived metrics', () => {
  it('elapsedDays counts inclusive days and freezes on completion', () => {
    expect(elapsedDays(null, 'in_progress', null, '2026-06-22')).toBeNull()
    expect(elapsedDays('2026-06-01', 'in_progress', null, '2026-06-22')).toBe(22)
    expect(elapsedDays('2026-06-01', 'completed', '2026-06-10', '2026-06-22')).toBe(10)
    expect(elapsedDays('2026-06-01', 'completed', null, '2026-06-22')).toBe(22)
  })

  it('costPerMinute needs a positive duration', () => {
    expect(costPerMinute(toMicros(100), null)).toBeNull()
    expect(costPerMinute(toMicros(100), 0)).toBeNull()
    expect(costPerMinute(toMicros(100), 50)).toBe(2)
  })

  it('completionRatio clamps to [0,1]', () => {
    expect(completionRatio(null, 3)).toBeNull()
    expect(completionRatio(0, 3)).toBeNull()
    expect(completionRatio(10, null)).toBeNull()
    expect(completionRatio(10, 3)).toBe(0.3)
    expect(completionRatio(10, 20)).toBe(1)
    expect(completionRatio(10, -1)).toBe(0)
  })
})

describe('compute-ledger calc: normalization', () => {
  it('normalizeProjectName trims leading/trailing and inner whitespace, NFKC', () => {
    expect(normalizeProjectName(' 猫、浴缸和早上八点')).toBe('猫、浴缸和早上八点')
    expect(normalizeProjectName('  A   B  ')).toBe('a b')
    expect(normalizeProjectName('ＡＢＣ')).toBe('abc')
  })

  it('normalizeCategory dedupes multi-select dirty data and takes the first', () => {
    expect(normalizeCategory('短片,短片')).toBe('short')
    expect(normalizeCategory('甲方Demo,甲方Demo')).toBe('client_demo')
    expect(normalizeCategory('精品、测试')).toBe('premium')
    expect(normalizeCategory('未知类型')).toBeNull()
    expect(normalizeCategory('')).toBeNull()
    expect(normalizeCategory(null)).toBeNull()
  })

  it('actorKey shares one key space between facts and entries', () => {
    expect(actorKey('u1', '宋国傲')).toBe('u:u1')
    expect(actorKey(null, '期初结转')).toBe('l:期初结转')
    expect(actorKey(undefined, '马俊')).toBe('l:马俊')
  })
})