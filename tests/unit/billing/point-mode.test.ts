import { describe, expect, it } from 'vitest'
import { DEFAULT_POINT_MODE, normalizePointMode, parsePointMode } from '@/lib/billing/point-mode'

describe('billing point mode', () => {
  it('defaults to unlimited for legacy and malformed values', () => {
    expect(DEFAULT_POINT_MODE).toBe('unlimited')
    expect(normalizePointMode(undefined)).toBe('unlimited')
    expect(normalizePointMode(null)).toBe('unlimited')
    expect(normalizePointMode('')).toBe('unlimited')
    expect(normalizePointMode('shared')).toBe('unlimited')
    expect(normalizePointMode('ALLOCATED')).toBe('unlimited')
  })

  it('preserves the two supported modes', () => {
    expect(normalizePointMode('unlimited')).toBe('unlimited')
    expect(normalizePointMode('allocated')).toBe('allocated')
  })

  it('rejects unknown input at the API boundary without defaulting', () => {
    expect(parsePointMode('unlimited')).toBe('unlimited')
    expect(parsePointMode('allocated')).toBe('allocated')
    expect(parsePointMode(undefined)).toBeNull()
    expect(parsePointMode(null)).toBeNull()
    expect(parsePointMode('')).toBeNull()
    expect(parsePointMode('shared')).toBeNull()
  })
})
