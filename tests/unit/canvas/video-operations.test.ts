import { describe, expect, it } from 'vitest'
import { normalizeCanvasVideoRegion } from '@/lib/canvas/video-operations'

describe('canvas video operations', () => {
  it('keeps subtitle erase selections in the lower half of the frame', () => {
    expect(normalizeCanvasVideoRegion({ x: 0.1, y: 0.2, width: 0.7, height: 0.3 }, 'subtitle')).toEqual({
      x: 0.1,
      y: 0.5,
      width: 0.7,
      height: 0.3,
    })
  })

  it('allows full-frame text erasing and clamps the selection', () => {
    expect(normalizeCanvasVideoRegion({ x: -1, y: 0.1, width: 4, height: 4 }, 'text')).toEqual({
      x: 0,
      y: 0.1,
      width: 1,
      height: 0.9,
    })
  })

  it('rejects non-finite coordinates', () => {
    expect(() => normalizeCanvasVideoRegion({ x: Number.NaN, y: 0.5, width: 0.5, height: 0.2 })).toThrow('去字幕区域格式无效')
  })
})
