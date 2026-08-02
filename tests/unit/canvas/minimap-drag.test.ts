import { describe, expect, it } from 'vitest'
import { beginMiniMapDrag, miniMapViewportForPointer } from '@/features/canvas/minimap-drag'

describe('canvas minimap drag geometry', () => {
  it('preserves the point grabbed inside the visible viewport', () => {
    const drag = beginMiniMapDrag(
      { x: 400, y: 275 },
      { x: -200, y: -100, zoom: 2 },
      { width: 1000, height: 800 },
    )

    expect(drag).toEqual({ pointerToCenter: { x: 50, y: 25 }, zoom: 2 })
    expect(miniMapViewportForPointer(
      { x: 420, y: 305 },
      drag!,
      { width: 1000, height: 800 },
    )).toEqual({ x: -240, y: -160, zoom: 2 })
  })

  it('does not jump when pointer position has not changed', () => {
    const viewport = { x: 125, y: -80, zoom: 0.75 }
    const size = { width: 1280, height: 720 }
    const pointer = { x: 900, y: 300 }
    const drag = beginMiniMapDrag(pointer, viewport, size)

    expect(miniMapViewportForPointer(pointer, drag!, size)).toEqual(viewport)
  })

  it('rejects invalid viewport geometry', () => {
    expect(beginMiniMapDrag({ x: 1, y: 2 }, { x: 0, y: 0, zoom: 0 }, { width: 100, height: 100 })).toBeNull()
    expect(beginMiniMapDrag({ x: 1, y: 2 }, { x: 0, y: 0, zoom: 1 }, { width: 0, height: 100 })).toBeNull()
  })
})
