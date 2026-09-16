import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  findCanvasTargetNodeIdAtPoint,
  resolveCanvasConnectionEndpoint,
  resolveCanvasNodeEdgeEndpoint,
  resolveCanvasRenderedScale,
} from '@/features/canvas/connection-line-geometry'

describe('canvas connection line geometry', () => {
  it('uses the zoom-aware connection line on the canvas surface', () => {
    const graph = fs.readFileSync(path.join(process.cwd(), 'src/features/canvas/CanvasGraph.tsx'), 'utf8')
    expect(graph).toContain('connectionLineComponent={CanvasConnectionLine}')
    const line = fs.readFileSync(path.join(process.cwd(), 'src/features/canvas/components/CanvasConnectionLine.tsx'), 'utf8')
    expect(line).toContain('resolveCanvasNodeEdgeEndpoint')
    expect(line).toContain('props.fromNode')
    expect(line).toContain('props.toNode && props.toHandle')
    expect(line).toContain('findCanvasTargetNodeIdAtPoint')
    expect(line).toContain('areaTargetNode')
    expect(line).toContain('hasHandleTarget')
  })

  it('preserves React Flow coordinates when the canvas is not externally scaled', () => {
    const renderedScale = resolveCanvasRenderedScale({
      layoutWidth: 1_000,
      layoutHeight: 600,
      renderedWidth: 1_000,
      renderedHeight: 600,
    })

    expect(resolveCanvasConnectionEndpoint({
      pointer: { x: 500, y: 340 },
      fallback: { x: 210, y: 180 },
      viewport: { x: 80, y: -20, zoom: 2 },
      renderedScale,
      anchored: false,
    })).toEqual({ x: 210, y: 180 })
  })

  it('removes the global 120 percent interface zoom from a free endpoint', () => {
    const renderedScale = resolveCanvasRenderedScale({
      layoutWidth: 1_000,
      layoutHeight: 600,
      renderedWidth: 1_200,
      renderedHeight: 720,
    })

    expect(resolveCanvasConnectionEndpoint({
      pointer: { x: 600, y: 360 },
      fallback: { x: 1_000, y: 1_000 },
      viewport: { x: 40, y: -30, zoom: 1.5 },
      renderedScale,
      anchored: false,
    })).toEqual({ x: 920 / 3, y: 220 })
  })

  it('supports independent horizontal and vertical rendered scales', () => {
    const renderedScale = resolveCanvasRenderedScale({
      layoutWidth: 800,
      layoutHeight: 400,
      renderedWidth: 1_000,
      renderedHeight: 600,
    })

    expect(resolveCanvasConnectionEndpoint({
      pointer: { x: 625, y: 450 },
      fallback: { x: 0, y: 0 },
      viewport: { x: 25, y: 30, zoom: 2 },
      renderedScale,
      anchored: false,
    })).toEqual({ x: 237.5, y: 135 })
  })

  it('falls back to an unscaled surface before layout dimensions are ready', () => {
    expect(resolveCanvasRenderedScale({
      layoutWidth: 0,
      layoutHeight: Number.NaN,
      renderedWidth: 1_200,
      renderedHeight: 720,
    })).toEqual({ x: 1, y: 1 })
  })

  it('keeps the exact handle coordinate after a valid snap', () => {
    expect(resolveCanvasConnectionEndpoint({
      pointer: { x: 720, y: 420 },
      fallback: { x: 480, y: 260 },
      viewport: { x: 0, y: 0, zoom: 1 },
      renderedScale: { x: 1.2, y: 1.2 },
      anchored: true,
    })).toEqual({ x: 480, y: 260 })
  })

  it('attaches persisted edge endpoints exactly to the node frame border', () => {
    const positionAbsolute = { x: 120, y: 80 }
    const measuredWidth = 300
    const measuredHeight = 200

    expect(resolveCanvasNodeEdgeEndpoint({
      positionAbsolute,
      measuredWidth,
      measuredHeight,
      position: 'left',
    })).toEqual({ x: 120, y: 180 })
    expect(resolveCanvasNodeEdgeEndpoint({
      positionAbsolute,
      measuredWidth,
      measuredHeight,
      position: 'right',
    })).toEqual({ x: 420, y: 180 })
    expect(resolveCanvasNodeEdgeEndpoint({
      positionAbsolute,
      measuredWidth,
      measuredHeight,
      position: 'top',
    })).toEqual({ x: 270, y: 80 })
    expect(resolveCanvasNodeEdgeEndpoint({
      positionAbsolute,
      measuredWidth,
      measuredHeight,
      position: 'bottom',
    })).toEqual({ x: 270, y: 280 })
  })

  it('treats the whole node area as a valid connection target', () => {
    const nodes = [
      { id: 'a', internals: { positionAbsolute: { x: 100, y: 100 }, z: 1 }, measured: { width: 300, height: 200 } },
      { id: 'b', internals: { positionAbsolute: { x: 500, y: 100 }, z: 2 }, measured: { width: 300, height: 200 } },
    ]

    expect(findCanvasTargetNodeIdAtPoint({ nodes, point: { x: 620, y: 150 } })).toBe('b')
    expect(findCanvasTargetNodeIdAtPoint({
      nodes,
      point: { x: 620, y: 150 },
      excludeNodeId: 'b',
    })).toBeNull()
    expect(findCanvasTargetNodeIdAtPoint({ nodes, point: { x: 60, y: 60 } })).toBeNull()
  })
})
