import { describe, expect, it } from 'vitest'
import { canvasBulkRemovalReason, isCanvasRecoverySummary } from '@/lib/canvas/save-guard'

describe('canvas bulk removal guard', () => {
  it('lets ordinary deletions through on a large canvas', () => {
    expect(canvasBulkRemovalReason({ existingNodes: 643, removedNodes: 30, existingEdges: 692, removedEdges: 34 })).toBeNull()
  })

  it('catches the stale-snapshot shape that removed 289 of 643 nodes', () => {
    expect(canvasBulkRemovalReason({ existingNodes: 643, removedNodes: 289, existingEdges: 692, removedEdges: 309 })).toContain('289 个节点')
  })

  it('catches edge-only rewrites and keeps a floor for small canvases', () => {
    expect(canvasBulkRemovalReason({ existingNodes: 60, removedNodes: 0, existingEdges: 59, removedEdges: 39 })).toContain('39 条连线')
    expect(canvasBulkRemovalReason({ existingNodes: 8, removedNodes: 8, existingEdges: 7, removedEdges: 7 })).toBeNull()
  })

  it('recognises the summaries the editor stamps on recovery and merge saves', () => {
    for (const summary of ['恢复本地未同步版本', '自动合并多标签页更改', '同步并合并其他标签页更改', '重新合并多标签更改']) {
      expect(isCanvasRecoverySummary(summary)).toBe(true)
    }
    expect(isCanvasRecoverySummary('编辑画布')).toBe(false)
    expect(isCanvasRecoverySummary(null)).toBe(false)
  })
})
