import { describe, expect, it } from 'vitest'
import { resolveViewportPopover } from '@/components/ui/viewport-popover'

describe('viewport-bounded popovers', () => {
  const viewport = { left: 0, top: 0, width: 1280, height: 720 }

  it('flips a picker upward near the bottom and keeps it in the viewport', () => {
    const rect = resolveViewportPopover(
      { left: 1020, right: 1440, top: 540, bottom: 690, width: 420 },
      viewport,
      { width: 420, height: 340, maxHeight: 340, preferredSide: 'below' },
    )
    expect(rect.side).toBe('above')
    expect(rect.left + rect.width).toBeLessThanOrEqual(1268)
    expect(rect.top).toBeGreaterThanOrEqual(12)
    expect(rect.top + rect.maxHeight).toBeLessThanOrEqual(708)
  })

  it('flips a parameter panel downward when there is no space above', () => {
    const rect = resolveViewportPopover(
      { left: 30, right: 190, top: 20, bottom: 58, width: 160 },
      viewport,
      { width: 400, height: 290, maxHeight: 420, preferredSide: 'above' },
    )
    expect(rect.side).toBe('below')
    expect(rect.top).toBe(66)
    expect(rect.width).toBe(400)
  })

  it('clamps width and height on narrow, short or zoomed visual viewports', () => {
    for (const small of [
      { left: 0, top: 0, width: 320, height: 400 },
      { left: 100, top: 200, width: 600, height: 320 },
    ]) {
      const rect = resolveViewportPopover(
        { left: 2, right: 482, top: 100, bottom: 800, width: 480 },
        small,
        { width: 400, height: 440, maxHeight: 420, preferredSide: 'below' },
      )
      expect(rect.left).toBeGreaterThanOrEqual(small.left + 12)
      expect(rect.left + rect.width).toBeLessThanOrEqual(small.left + small.width - 12)
      expect(rect.top).toBeGreaterThanOrEqual(small.top + 12)
      expect(rect.top + Math.min(440, rect.maxHeight)).toBeLessThanOrEqual(small.top + small.height - 12)
    }
  })
})
