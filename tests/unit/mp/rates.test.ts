import { describe, expect, it } from 'vitest'
import { toWxRate, WX_RATES } from '../../../miniprogram/miniprogram/pkg-play/lib/rates'

describe('toWxRate', () => {
  it('exposes the native playbackRate ladder', () => {
    expect([...WX_RATES]).toEqual([0.5, 0.8, 1.0, 1.25, 1.5, 2.0])
  })

  it.each([
    [0.1, 0.5],
    [0.25, 0.5],
    [0.5, 0.5],
    [0.6, 0.5],
    [0.65, 0.5],
    [0.7, 0.8],
    [0.8, 0.8],
    [0.9, 0.8],
    [1.0, 1.0],
    [1.1, 1.0],
    [1.125, 1.0],
    [1.2, 1.25],
    [1.25, 1.25],
    [1.375, 1.25],
    [1.4, 1.5],
    [1.5, 1.5],
    [1.75, 1.5],
    [2.0, 2.0],
    [3, 2.0],
  ])('maps %s to the supported rate %s', (input, expected) => {
    expect(toWxRate(input)).toBe(expected)
  })

  it('breaks ties toward the lower rate', () => {
    expect(toWxRate(0.65)).toBe(0.5)
    expect(toWxRate(0.9)).toBe(0.8)
    expect(toWxRate(1.125)).toBe(1.0)
    expect(toWxRate(1.375)).toBe(1.25)
    expect(toWxRate(1.75)).toBe(1.5)
  })

  it('always returns a member of the ladder', () => {
    for (let r = 0; r <= 3; r += 0.05) {
      expect(WX_RATES).toContain(toWxRate(r))
    }
  })
})
