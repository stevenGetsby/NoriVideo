import { createHash } from 'node:crypto'

export type CanvasProductionNodeKind = 'episode' | 'storyboard' | 'panel' | 'video'

function digest(parts: string[]) {
  return createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 32)
}

/**
 * CanvasNode.id is a global primary key, so production projections must include
 * the destination canvas in their stable identity. Keeping the readable kind
 * prefix also makes production rows easy to identify during maintenance.
 */
export function canvasProductionNodeId(
  canvasId: string,
  kind: CanvasProductionNodeKind,
  sourceId: string,
) {
  return `prod_${kind}_${digest([canvasId, kind, sourceId])}`
}

/** CanvasEdge.id is global as well; scope deterministic projection edges too. */
export function canvasProductionEdgeId(
  canvasId: string,
  sourceNodeId: string,
  targetNodeId: string,
) {
  return `prod_edge_${digest([canvasId, sourceNodeId, targetNodeId])}`
}
