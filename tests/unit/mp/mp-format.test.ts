import { describe, expect, it } from 'vitest'
import { formatCount, formatDate, formatDuration, formatRelative } from '../../../miniprogram/miniprogram/lib/format'

describe('formatCount', () => {
  it('renders raw below 万 and one-decimal 万 above', () => {
    expect(formatCount(0)).toBe('0')
    expect(formatCount(9999)).toBe('9999')
    expect(formatCount(10000)).toBe('1.0万')
    expect(formatCount(12000)).toBe('1.2万')
    expect(formatCount(12345)).toBe('1.2万')
    expect(formatCount(100000)).toBe('10.0万')
    expect(formatCount(123456)).toBe('12.3万')
  })

  it('coerces non-positive and non-finite to 0', () => {
    expect(formatCount(-5)).toBe('0')
    expect(formatCount(NaN)).toBe('0')
    expect(formatCount(Infinity)).toBe('0')
    expect(formatCount(12.9)).toBe('12')
  })
})

describe('formatDuration', () => {
  it('pads mm:ss and lets minutes exceed 59', () => {
    expect(formatDuration(0)).toBe('00:00')
    expect(formatDuration(5)).toBe('00:05')
    expect(formatDuration(65)).toBe('01:05')
    expect(formatDuration(600)).toBe('10:00')
    expect(formatDuration(3661)).toBe('61:01')
  })
})

describe('formatDate (Beijing)', () => {
  it('crosses timezone into next day', () => {
    expect(formatDate('2026-11-17T16:30:00Z')).toBe('11月18日')
    expect(formatDate('2026-11-17T16:30:00Z', true)).toBe('11月18日 00:30')
  })

  it('renders same-day time', () => {
    expect(formatDate('2026-11-17T02:00:00Z', true)).toBe('11月17日 10:00')
  })
})

describe('formatRelative', () => {
  const now = Date.parse('2026-11-17T12:00:00Z')
  it('buckets seconds/minutes/hours/days then falls back to date', () => {
    expect(formatRelative(now - 30_000, now)).toBe('刚刚')
    expect(formatRelative(now - 5 * 60_000, now)).toBe('5分钟前')
    expect(formatRelative(now - 2 * 3_600_000, now)).toBe('2小时前')
    expect(formatRelative(now - 3 * 86_400_000, now)).toBe('3天前')
    expect(formatRelative(now - 40 * 86_400_000, now)).toBe('10月8日')
  })

  it('clamps future timestamps to 刚刚', () => {
    expect(formatRelative(now + 60_000, now)).toBe('刚刚')
  })
})
