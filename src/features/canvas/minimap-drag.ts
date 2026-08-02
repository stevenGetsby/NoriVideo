export type MiniMapPoint = { x: number; y: number }

export type MiniMapViewport = MiniMapPoint & { zoom: number }

export type MiniMapViewportSize = { width: number; height: number }

export type MiniMapDragState = {
  pointerToCenter: MiniMapPoint
  zoom: number
}

function isFinitePoint(point: MiniMapPoint) {
  return Number.isFinite(point.x) && Number.isFinite(point.y)
}

/**
 * Store the grab point relative to the current viewport centre. MiniMap SVG
 * coordinates are flow coordinates, so this remains correct under CSS zoom.
 */
export function beginMiniMapDrag(
  pointer: MiniMapPoint,
  viewport: MiniMapViewport,
  size: MiniMapViewportSize,
): MiniMapDragState | null {
  if (!isFinitePoint(pointer) || !isFinitePoint(viewport) || !Number.isFinite(viewport.zoom) || viewport.zoom <= 0) return null
  if (!Number.isFinite(size.width) || !Number.isFinite(size.height) || size.width <= 0 || size.height <= 0) return null

  const center = {
    x: (size.width / 2 - viewport.x) / viewport.zoom,
    y: (size.height / 2 - viewport.y) / viewport.zoom,
  }
  return {
    pointerToCenter: {
      x: pointer.x - center.x,
      y: pointer.y - center.y,
    },
    zoom: viewport.zoom,
  }
}

/** Resolve a dragged MiniMap pointer back into React Flow's viewport transform. */
export function miniMapViewportForPointer(
  pointer: MiniMapPoint,
  drag: MiniMapDragState,
  size: MiniMapViewportSize,
): MiniMapViewport | null {
  if (!isFinitePoint(pointer) || !isFinitePoint(drag.pointerToCenter) || !Number.isFinite(drag.zoom) || drag.zoom <= 0) return null
  if (!Number.isFinite(size.width) || !Number.isFinite(size.height) || size.width <= 0 || size.height <= 0) return null

  const center = {
    x: pointer.x - drag.pointerToCenter.x,
    y: pointer.y - drag.pointerToCenter.y,
  }
  return {
    x: size.width / 2 - center.x * drag.zoom,
    y: size.height / 2 - center.y * drag.zoom,
    zoom: drag.zoom,
  }
}

/**
 * getScreenCTM includes the application-level 120% CSS zoom. Inverting it is
 * the reliable way to turn a pointer into the MiniMap's flow-space viewBox.
 */
export function miniMapFlowPointFromClient(
  svg: SVGSVGElement,
  client: MiniMapPoint,
): MiniMapPoint | null {
  const matrix = svg.getScreenCTM()
  if (!matrix) return null
  try {
    const point = svg.createSVGPoint()
    point.x = client.x
    point.y = client.y
    const flowPoint = point.matrixTransform(matrix.inverse())
    return isFinitePoint(flowPoint) ? { x: flowPoint.x, y: flowPoint.y } : null
  } catch {
    return null
  }
}
