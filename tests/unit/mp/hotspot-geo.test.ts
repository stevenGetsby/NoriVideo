import { existsSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { hotspotAt, mediaContainBox } from '@/lib/interactive/hotspot'
import type { StoryHotspotZone } from '@/lib/interactive/types'
import { hotspotHandleAt } from '../../../miniprogram/miniprogram/pkg-play/lib/hotspot-geo'

if (!existsSync(path.resolve(process.cwd(), 'miniprogram/miniprogram/runtime/story-runtime.js'))) {
  throw new Error('先运行 npm --prefix miniprogram run build:runtime')
}

const zones: StoryHotspotZone[] = [
  { id: 'photo', label: '照片', x: 0.1, y: 0.1, w: 0.3, h: 0.3 },
  { id: 'vase', label: '花瓶', x: 0.6, y: 0.6, w: 0.3, h: 0.3 },
]

describe('hotspotHandleAt', () => {
  it('letterboxes a wide stage and agrees with the Web contain-box + hotspotAt', () => {
    // 800x600 stage, 1280x720 media -> scale 0.625 -> 800x450 centered, top bar 75.
    const box = mediaContainBox(800, 600, 1280, 720)
    expect(box).toEqual({ left: 0, top: 75, width: 800, height: 450 })
    // photo centre normalized (0.25, 0.25) -> stage (200, 187.5)
    expect(hotspotHandleAt(zones, 800, 600, 1280, 720, 200, 187.5)).toBe('photo')
    expect(hotspotHandleAt(zones, 800, 600, 1280, 720, 200, 187.5)).toBe(hotspotAt(zones, box, 200, 187.5))
  })

  it('pillarboxes a tall stage and agrees with the Web geometry', () => {
    // 600x800 stage, 1280x720 media -> scale 0.46875 -> 600x337.5 centered, top 231.25.
    const box = mediaContainBox(600, 800, 1280, 720)
    expect(box?.left).toBe(0)
    expect(box?.top).toBeCloseTo(231.25, 5)
    // vase centre normalized (0.75, 0.75) -> stage (450, 484.375)
    expect(hotspotHandleAt(zones, 600, 800, 1280, 720, 450, 484.375)).toBe('vase')
    expect(hotspotHandleAt(zones, 600, 800, 1280, 720, 450, 484.375)).toBe(hotspotAt(zones, box, 450, 484.375))
  })

  it('returns null in the black bars outside the contained frame', () => {
    expect(hotspotHandleAt(zones, 800, 600, 1280, 720, 400, 10)).toBeNull()
    expect(hotspotHandleAt(zones, 800, 600, 1280, 720, 400, 590)).toBeNull()
  })

  it('returns null inside the frame but outside every zone', () => {
    expect(hotspotHandleAt(zones, 800, 600, 1280, 720, 400, 300)).toBeNull()
  })

  it('lets later zones win where they overlap', () => {
    const overlapping: StoryHotspotZone[] = [...zones, { id: 'top', label: '重叠', x: 0.2, y: 0.2, w: 0.2, h: 0.2 }]
    expect(hotspotHandleAt(overlapping, 800, 600, 1280, 720, 200, 187.5)).toBe('top')
  })

  it('returns null for a degenerate stage or media', () => {
    expect(hotspotHandleAt(zones, 0, 600, 1280, 720, 100, 100)).toBeNull()
    expect(hotspotHandleAt(zones, 800, 600, 0, 720, 100, 100)).toBeNull()
  })
})
