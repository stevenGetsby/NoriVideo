import { describe, expect, it } from 'vitest'
import {
  POSTER_CARD, POSTER_H, POSTER_QR, POSTER_W,
  coverCrop, endingMiddle, fitText, workMiddle, wrapText,
} from '../../../miniprogram/miniprogram/lib/poster-layout'

const measure = (text: string) => text.length * 10

describe('coverCrop', () => {
  it('center-crops a wide image to the poster ratio', () => {
    const crop = coverCrop(1500, 1000)
    expect(crop.sh).toBeCloseTo(1000, 5)
    expect(crop.sw).toBeCloseTo(750 / (1334 / 1000), 5)
    expect(crop.sx).toBeCloseTo((1500 - crop.sw) / 2, 5)
    expect(crop.sy).toBe(0)
    expect(crop.sw / crop.sh).toBeCloseTo(POSTER_W / POSTER_H, 5)
  })

  it('center-crops a tall image to the poster ratio', () => {
    const crop = coverCrop(500, 2000)
    expect(crop.sw).toBe(500)
    expect(crop.sh).toBeCloseTo(1334 / 1.5, 5)
    expect(crop.sx).toBe(0)
    expect(crop.sy).toBeCloseTo((2000 - crop.sh) / 2, 5)
  })

  it('falls back to the full target when dimensions are unknown', () => {
    expect(coverCrop(0, 0)).toEqual({ sx: 0, sy: 0, sw: POSTER_W, sh: POSTER_H })
  })
})

describe('fitText', () => {
  it('keeps text that fits', () => {
    expect(fitText('1234567890', 100, measure)).toBe('1234567890')
  })

  it('truncates with an ellipsis inside the budget', () => {
    const out = fitText('123456789012345', 100, measure)
    expect(out).toBe('123456789…')
    expect(measure(out)).toBeLessThanOrEqual(100)
  })

  it('handles empty text', () => {
    expect(fitText('', 100, measure)).toBe('')
  })
})

describe('wrapText', () => {
  it('returns short text as a single line', () => {
    expect(wrapText('abc', 100, 2, measure)).toEqual(['abc'])
  })

  it('wraps into at most maxLines and ellipsizes the overflow', () => {
    const text = '1234567890123456789012345'
    expect(wrapText(text, 100, 2, measure)).toEqual(['1234567890', '123456789…'])
  })

  it('collapses to a single ellipsized line when maxLines is 1', () => {
    expect(wrapText('1234567890123', 100, 1, measure)).toEqual(['123456789…'])
  })

  it('returns no lines for empty text', () => {
    expect(wrapText('', 100, 2, measure)).toEqual([])
  })
})

describe('poster geometry', () => {
  it('keeps the QR code inside the bottom card', () => {
    expect(POSTER_QR.x).toBeGreaterThanOrEqual(POSTER_CARD.x)
    expect(POSTER_QR.x + POSTER_QR.size).toBeLessThanOrEqual(POSTER_CARD.x + POSTER_CARD.w)
    expect(POSTER_QR.y).toBeGreaterThanOrEqual(POSTER_CARD.y)
    expect(POSTER_QR.y + POSTER_QR.size).toBeLessThanOrEqual(POSTER_CARD.y + POSTER_CARD.h)
  })

  it('keeps the ending middle block above the card even with two lines and rarity', () => {
    const middle = endingMiddle(2, true)
    expect(middle.tagY).toBe(820)
    expect(middle.lineY).toBe(884)
    expect(middle.nameY).toBe(930)
    expect(middle.rarityY).not.toBeNull()
    expect((middle.rarityY as number) + 26).toBeLessThanOrEqual(POSTER_CARD.y)
  })

  it('omits rarity position when there is no rarity text', () => {
    expect(endingMiddle(1, false).rarityY).toBeNull()
  })

  it('drops work tags when they would collide with the card', () => {
    const compact = workMiddle(1, 1)
    expect(compact.tagsY).not.toBeNull()
    expect((compact.tagsY as number) + 40).toBeLessThanOrEqual(POSTER_CARD.y)
    expect(workMiddle(2, 2).tagsY).toBeNull()
  })
})
