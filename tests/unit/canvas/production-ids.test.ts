import { describe, expect, it } from 'vitest'
import { canvasProductionEdgeId, canvasProductionNodeId } from '@/lib/canvas/production-ids'

describe('canvas production projection ids', () => {
  it('is stable inside one canvas and isolated across canvases', () => {
    const first = canvasProductionNodeId('canvas-a', 'panel', 'panel-1')
    expect(canvasProductionNodeId('canvas-a', 'panel', 'panel-1')).toBe(first)
    expect(canvasProductionNodeId('canvas-b', 'panel', 'panel-1')).not.toBe(first)
  })

  it('scopes edges and keeps all generated ids within the database limit', () => {
    const source = canvasProductionNodeId('canvas-a', 'storyboard', 'storyboard-1')
    const target = canvasProductionNodeId('canvas-a', 'panel', 'panel-1')
    const first = canvasProductionEdgeId('canvas-a', source, target)
    expect(canvasProductionEdgeId('canvas-b', source, target)).not.toBe(first)
    expect(source.length).toBeLessThanOrEqual(191)
    expect(target.length).toBeLessThanOrEqual(191)
    expect(first.length).toBeLessThanOrEqual(191)
  })
})
