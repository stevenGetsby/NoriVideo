import { describe, expect, it } from 'vitest'
import { dragHotspotZone, hotspotAt, hotspotZonesOverlap, mediaContainBox, unrotateHotspotPoint } from '@/lib/interactive/hotspot'
import type { StoryHotspotZone } from '@/lib/interactive/types'

const zone = (id: string, x: number, y: number, w = 0.2, h = 0.2): StoryHotspotZone => ({ id, label: id, x, y, w, h })

describe('hotspot geometry', () => {
  it('accounts for letterboxing and never hits the padding', () => {
    const box = mediaContainBox(400, 400, 320, 180)
    expect(box).toEqual({ left: 0, top: 87.5, width: 400, height: 225 })
    expect(hotspotAt([zone('photo', 0.4, 0.4)], box, 200, 200)).toBe('photo')
    expect(hotspotAt([zone('photo', 0.4, 0.4)], box, 200, 50)).toBeNull()
    expect(hotspotAt([zone('photo', 0.4, 0.4)], null, 200, 200)).toBeNull()
  })

  it('hits the later of two overlapping zones', () => {
    const box = mediaContainBox(320, 180, 320, 180)
    expect(hotspotAt([zone('below', 0, 0, 1, 1), zone('above', 0.4, 0.4)], box, 160, 90)).toBe('above')
  })

  it('unrotates points on a quarter-turned stage', () => {
    expect(unrotateHotspotPoint(50, 20, 200, 100, 1)).toEqual({ x: 20, y: 150 })
    expect(unrotateHotspotPoint(50, 20, 200, 100, 2)).toEqual({ x: 150, y: 80 })
    expect(unrotateHotspotPoint(50, 20, 200, 100, 3)).toEqual({ x: 80, y: 50 })
  })

  it('moves and resizes within the frame without collapsing a zone', () => {
    const initial = zone('photo', 0.4, 0.4)
    expect(dragHotspotZone(initial, 0.3, -0.9, 'move')).toMatchObject({ x: 0.7, y: 0 })
    expect(dragHotspotZone(initial, -0.9, 0, 'move')).toMatchObject({ x: 0 })
    expect(dragHotspotZone(initial, -0.1, -0.1, 'nw')).toMatchObject({ x: 0.3, y: 0.3, w: 0.3, h: 0.3 })
    expect(dragHotspotZone(initial, 0.9, 0.9, 'se')).toMatchObject({ x: 0.4, y: 0.4, w: 0.6, h: 0.6 })
    expect(dragHotspotZone(initial, 0.4, 0, 'nw')).toMatchObject({ x: 0.58, w: 0.02 })
    expect(dragHotspotZone(initial, -0.4, 0, 'ne')).toMatchObject({ x: 0.4, w: 0.02 })
    expect(dragHotspotZone(initial, -0.4, -0.4, 'sw')).toMatchObject({ x: 0, y: 0.4, w: 0.6, h: 0.02 })
  })

  it('detects overlapping but not touching rectangles', () => {
    expect(hotspotZonesOverlap(zone('a', 0, 0, 0.5, 0.5), zone('b', 0.4, 0.4))).toBe(true)
    expect(hotspotZonesOverlap(zone('a', 0, 0, 0.5, 0.5), zone('b', 0.5, 0, 0.5, 0.5))).toBe(false)
  })
})
