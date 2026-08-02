import { describe, expect, it } from 'vitest'
import {
  findCanvasNodeIdsIntersectingRect,
  findSvgEdgeIdsIntersectingRect,
  normalizeScreenRect,
  polylineIntersectsRect,
  screenRectSelectsNode,
} from '@/features/canvas/edge-marquee'

describe('canvas edge marquee geometry', () => {
  it('normalizes a drag in any direction and applies hit tolerance', () => {
    expect(normalizeScreenRect({ x: 40, y: 30 }, { x: 10, y: 5 }, 4)).toEqual({
      left: 6,
      top: 1,
      right: 44,
      bottom: 34,
    })
  })

  it('selects a wire when the marquee crosses the path even if no sampled endpoint is inside', () => {
    expect(polylineIntersectsRect(
      [{ x: 0, y: 50 }, { x: 100, y: 50 }],
      { left: 45, top: 40, right: 55, bottom: 60 },
    )).toBe(true)
  })

  it('does not select visually unrelated wires', () => {
    expect(polylineIntersectsRect(
      [{ x: 0, y: 10 }, { x: 100, y: 10 }],
      { left: 40, top: 40, right: 60, bottom: 60 },
    )).toBe(false)
  })

  it('accepts a meaningful partial node overlap but rejects a boundary brush', () => {
    const node = { left: 100, top: 100, right: 400, bottom: 300 }

    expect(screenRectSelectsNode(
      { left: 80, top: 80, right: 175, bottom: 320 },
      node,
    )).toBe(true)
    expect(screenRectSelectsNode(
      { left: 80, top: 80, right: 108, bottom: 320 },
      node,
    )).toBe(false)
  })

  it('targets visible content nodes while ignoring a containing group frame', () => {
    const element = (id: string, group: boolean, bounds: { left: number; top: number; right: number; bottom: number }) => ({
      dataset: { id },
      classList: { contains: (value: string) => group && value === 'react-flow__node-group' },
      querySelector: (selector: string) => group && selector === '.nori-canvas-group' ? {} : null,
      getBoundingClientRect: () => bounds,
    })
    const elements = [
      element('group', true, { left: 10, top: 10, right: 700, bottom: 700 }),
      element('inside', false, { left: 120, top: 140, right: 420, bottom: 340 }),
      element('away', false, { left: 820, top: 140, right: 1120, bottom: 340 }),
    ]
    const container = { querySelectorAll: () => elements }

    expect(findCanvasNodeIdsIntersectingRect(
      container as unknown as Element,
      { left: 90, top: 110, right: 250, bottom: 370 },
    )).toEqual(['inside'])
  })

  it('samples rendered SVG paths in screen coordinates and returns every crossed edge id', () => {
    const path = {
      getTotalLength: () => 120,
      getPointAtLength: (distance: number) => ({ x: distance, y: 10 }),
      getScreenCTM: () => ({ a: 1, b: 0, c: 0, d: 1, e: 20, f: 40 }),
    }
    const unrelatedPath = {
      getTotalLength: () => 120,
      getPointAtLength: (distance: number) => ({ x: distance, y: 100 }),
      getScreenCTM: () => ({ a: 1, b: 0, c: 0, d: 1, e: 20, f: 40 }),
    }
    const groups = [
      { dataset: { id: 'edge-crossed' }, querySelector: () => path },
      { dataset: { id: 'edge-away' }, querySelector: () => unrelatedPath },
    ]
    const container = { querySelectorAll: () => groups }

    expect(findSvgEdgeIdsIntersectingRect(
      container as unknown as Element,
      { left: 70, top: 44, right: 85, bottom: 56 },
    )).toEqual(['edge-crossed'])
  })
})
