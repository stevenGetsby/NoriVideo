/** Saves the editor produces on its own (recovery / merge), not from a direct user edit. */
export const CANVAS_RECOVERY_SUMMARIES: ReadonlySet<string> = new Set([
  '恢复本地未同步版本',
  '自动合并多标签页更改',
  '同步并合并其他标签页更改',
  '重新合并多标签更改',
])

const NODE_REMOVAL_FLOOR = 10
const EDGE_REMOVAL_FLOOR = 20
const REMOVAL_RATIO = 0.05

export function isCanvasRecoverySummary(summary: string | null | undefined): boolean {
  return Boolean(summary && CANVAS_RECOVERY_SUMMARIES.has(summary))
}

/** Null when the save is fine, otherwise a user-facing reason. A stale snapshot replayed as a whole removes far more than a person deletes in one save. */
export function canvasBulkRemovalReason(input: {
  existingNodes: number
  removedNodes: number
  existingEdges: number
  removedEdges: number
}): string | null {
  const nodeLimit = Math.max(NODE_REMOVAL_FLOOR, Math.ceil(input.existingNodes * REMOVAL_RATIO))
  const edgeLimit = Math.max(EDGE_REMOVAL_FLOOR, Math.ceil(input.existingEdges * REMOVAL_RATIO))
  if (input.removedNodes > nodeLimit) return `这次保存会一次删除 ${input.removedNodes} 个节点，疑似来自过期的本地版本，已拦截。请重新加载最新画布。`
  if (input.removedEdges > edgeLimit) return `这次保存会一次删除 ${input.removedEdges} 条连线，疑似来自过期的本地版本，已拦截。请重新加载最新画布。`
  return null
}
