import type { ReactFlowState } from '@xyflow/react'

export const CANVAS_LOW_DETAIL_ZOOM = 0.35

// Subscribing to raw zoom re-renders every node on each pan/zoom frame. Nodes
// only need to react when crossing a detail threshold, so select a coarse bucket.
export const selectZoomBucket = (state: ReactFlowState): number => {
  const zoom = state.transform[2]
  return zoom < CANVAS_LOW_DETAIL_ZOOM ? 0 : zoom < 0.7 ? 1 : zoom < 1.4 ? 2 : zoom < 3 ? 3 : zoom < 4.5 ? 4 : 5
}
