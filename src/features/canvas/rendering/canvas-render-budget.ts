export type CanvasRenderMode = 'full' | 'overview'
export type CanvasGesture = 'idle' | 'panning' | 'zooming' | 'dragging' | 'selecting'

export const CANVAS_RENDER_BUDGET = Object.freeze({
  fullNodes: 80,
  selectedFullLimit: 40,
  maxFullGroups: 64,
  activeEdges: 160,
  activeEdgesInGesture: 120,
  overviewColumns: 32,
  overviewRows: 18,
  overviewNodeRects: 32 * 18,
  overviewEdgeLines: 600,
  projectNodeThreshold: 80,
  projectEdgeThreshold: 160,
  overviewEnterZoom: 0.3,
  overviewExitZoom: 0.38,
  viewportBufferPx: 200,
  maxNodeVisits: 1024,
  maxEdgeVisits: 4096,
  maxPreviewsInFlight: 8,
  maxPlayingInstances: 2,
  deactivateNodeThreshold: 64,
  deactivateEdgeThreshold: 128,
  requeryPanPx: 100,
  requeryZoomRatio: 1.1,
})

export type CanvasQueryKey = { x: number; y: number; zoom: number; width: number; height: number }

export function isProjectionStillNeeded(nodeCount: number, edgeCount: number, wasActive: boolean): boolean {
  if (!wasActive) return shouldProjectCanvas(nodeCount, edgeCount)
  // Dropping out only well below the entry threshold stops a graph near 80 nodes from toggling the whole pipeline.
  return nodeCount > CANVAS_RENDER_BUDGET.deactivateNodeThreshold || edgeCount > CANVAS_RENDER_BUDGET.deactivateEdgeThreshold
}

// The queried rect carries a 200 CSS px buffer, so re-querying after half of it keeps every visible pixel covered.
export function needsRequery(last: CanvasQueryKey | null, next: CanvasQueryKey): boolean {
  if (!last) return true
  if (last.width !== next.width || last.height !== next.height) return true
  const ratio = next.zoom / last.zoom
  if (!Number.isFinite(ratio) || ratio > CANVAS_RENDER_BUDGET.requeryZoomRatio || ratio < 1 / CANVAS_RENDER_BUDGET.requeryZoomRatio) return true
  return Math.abs(next.x - last.x) > CANVAS_RENDER_BUDGET.requeryPanPx || Math.abs(next.y - last.y) > CANVAS_RENDER_BUDGET.requeryPanPx
}

export function isProtectedEdgeRole(role: string | undefined): boolean {
  return typeof role === 'string' && /^(STORY_|MOUNT|PICTURE)/.test(role)
}

export function shouldProjectCanvas(nodeCount: number, edgeCount: number): boolean {
  return nodeCount > CANVAS_RENDER_BUDGET.projectNodeThreshold
    || edgeCount > CANVAS_RENDER_BUDGET.projectEdgeThreshold
}

// Hysteresis keeps a viewport hovering around one threshold from flipping between layers.
export function resolveRenderMode(previous: CanvasRenderMode, zoom: number): CanvasRenderMode {
  if (previous === 'overview') return zoom >= CANVAS_RENDER_BUDGET.overviewExitZoom ? 'full' : 'overview'
  return zoom <= CANVAS_RENDER_BUDGET.overviewEnterZoom ? 'overview' : 'full'
}
