import { describe, expect, it } from 'vitest'
import { resolveCanvasGeneratorAnchor } from '@/features/canvas/generator-anchor'

describe('canvas generator node anchoring', () => {
  it('follows node and viewport movement below the node when space permits', () => {
    expect(resolveCanvasGeneratorAnchor({
      nodePosition: { x: 300, y: 80 },
      nodeSize: { width: 240, height: 160 },
      viewport: { x: 30, y: 20, zoom: 1.5 },
      surface: { width: 1400, height: 1000 },
    })).toEqual({
      x: 660,
      y: 396,
      placement: 'below',
      tetherX: 420,
      tetherLength: 16,
      maxHeight: 576,
    })
  })

  it('flips above a node near the bottom edge and clamps panel center horizontally', () => {
    expect(resolveCanvasGeneratorAnchor({
      nodePosition: { x: 1180, y: 620 },
      nodeSize: { width: 240, height: 160 },
      viewport: { x: 0, y: 0, zoom: 1 },
      surface: { width: 1280, height: 800 },
    })).toEqual({
      x: 820,
      y: 552,
      placement: 'above',
      tetherX: 812,
      tetherLength: 68,
      maxHeight: 436,
    })
  })

  it('keeps the editor header below the canvas chrome when neither side has ideal space', () => {
    const anchor = resolveCanvasGeneratorAnchor({
      nodePosition: { x: 300, y: 80 },
      nodeSize: { width: 240, height: 100 },
      viewport: { x: 0, y: 390, zoom: 1 },
      surface: { width: 1400, height: 650 },
    })

    if (!anchor) throw new Error('expected anchor')
    expect(anchor.placement).toBe('above')
    expect(anchor.y - anchor.maxHeight).toBe(116)
    expect(anchor.x).toBe(460)
  })

  it('shrinks below the node instead of covering it on a short viewport', () => {
    const anchor = resolveCanvasGeneratorAnchor({
      nodePosition: { x: 440, y: 140 },
      nodeSize: { width: 320, height: 180 },
      viewport: { x: 0, y: 0, zoom: 1 },
      surface: { width: 1280, height: 720 },
      safeBottom: 96,
    })

    expect(anchor).not.toBeNull()
    if (!anchor) return
    expect(anchor.placement).toBe('below')
    const nodeBottom = 140 + 180
    expect(anchor.y).toBeGreaterThanOrEqual(nodeBottom + 16)
    expect(anchor.y + anchor.maxHeight).toBeLessThanOrEqual(720 - 96 + 1)
  })

  it('falls back to the bottom-docked panel when neither side fits at all', () => {
    const anchor = resolveCanvasGeneratorAnchor({
      nodePosition: { x: 440, y: 260 },
      nodeSize: { width: 320, height: 180 },
      viewport: { x: 0, y: 0, zoom: 1 },
      surface: { width: 1280, height: 560 },
      safeBottom: 96,
    })

    expect(anchor).toBeNull()
  })

  it('keeps a below-panel clear of the node when the node sits high', () => {
    const anchor = resolveCanvasGeneratorAnchor({
      nodePosition: { x: 440, y: 40 },
      nodeSize: { width: 320, height: 180 },
      viewport: { x: 0, y: 0, zoom: 1 },
      surface: { width: 1280, height: 1080 },
      safeBottom: 96,
    })

    expect(anchor).not.toBeNull()
    if (!anchor) return
    const nodeBottom = 40 + 180
    expect(anchor.placement).toBe('below')
    expect(anchor.y).toBeGreaterThanOrEqual(nodeBottom + 16)
  })
})
