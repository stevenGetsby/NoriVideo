export type CanvasConnectionPoint = {
  x: number
  y: number
}

export type CanvasConnectionViewport = CanvasConnectionPoint & {
  zoom: number
}

export type CanvasEdgePosition = 'left' | 'right' | 'top' | 'bottom'

export type CanvasRenderedScale = CanvasConnectionPoint

export type CanvasNodeBoxLike = {
  id: string
  internals: {
    positionAbsolute: CanvasConnectionPoint
    z?: number
  }
  measured?: {
    width?: number
    height?: number
  }
  width?: number
  height?: number
}

function positiveFiniteOrOne(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1
}

function renderedRatioOrOne(renderedSize: number, layoutSize: number): number {
  if (!Number.isFinite(renderedSize) || renderedSize <= 0) return 1
  if (!Number.isFinite(layoutSize) || layoutSize <= 0) return 1
  return positiveFiniteOrOne(renderedSize / layoutSize)
}

export function resolveCanvasRenderedScale(input: {
  layoutWidth: number
  layoutHeight: number
  renderedWidth: number
  renderedHeight: number
}): CanvasRenderedScale {
  return {
    x: renderedRatioOrOne(input.renderedWidth, input.layoutWidth),
    y: renderedRatioOrOne(input.renderedHeight, input.layoutHeight),
  }
}

export function resolveCanvasConnectionEndpoint(input: {
  pointer: CanvasConnectionPoint
  fallback: CanvasConnectionPoint
  viewport: CanvasConnectionViewport
  renderedScale: CanvasRenderedScale
  anchored: boolean
}): CanvasConnectionPoint {
  if (input.anchored) return input.fallback

  const values = [
    input.pointer.x,
    input.pointer.y,
    input.viewport.x,
    input.viewport.y,
    input.viewport.zoom,
  ]
  if (values.some((value) => !Number.isFinite(value)) || input.viewport.zoom <= 0) return input.fallback

  const scaleX = positiveFiniteOrOne(input.renderedScale.x)
  const scaleY = positiveFiniteOrOne(input.renderedScale.y)

  return {
    x: (input.pointer.x / scaleX - input.viewport.x) / input.viewport.zoom,
    y: (input.pointer.y / scaleY - input.viewport.y) / input.viewport.zoom,
  }
}

function finiteNonNegative(value: number, fallback: number): number {
  return Number.isFinite(value) && value >= 0 ? value : fallback
}

/**
 * React Flow measures handle bounds in DOM pixels while node positions live in
 * flow coordinates. A CSS `zoom` on the FrameOS shell scales handle offsets
 * but not flow coordinates, so edges can stop short of or float away from the
 * node frame. Recomputing the endpoint from the node box gives a tight,
 * natural connection on the actual node border.
 */
export function resolveCanvasNodeEdgeEndpoint(input: {
  positionAbsolute: CanvasConnectionPoint
  measuredWidth: number
  measuredHeight: number
  position: CanvasEdgePosition
}): CanvasConnectionPoint {
  const width = finiteNonNegative(input.measuredWidth, 0)
  const height = finiteNonNegative(input.measuredHeight, 0)
  const x = input.positionAbsolute.x
  const y = input.positionAbsolute.y

  switch (input.position) {
    case 'right':
      return { x: x + width, y: y + height / 2 }
    case 'left':
      return { x, y: y + height / 2 }
    case 'top':
      return { x: x + width / 2, y }
    case 'bottom':
      return { x: x + width / 2, y: y + height }
    default:
      return { x: x + width / 2, y: y + height / 2 }
  }
}

/**
 * Area-based connection target: when the free end of a wire enters a node's
 * bounding box, that node becomes a valid target even if the pointer is not
 * on one of its handles.
 */
export function findCanvasTargetNodeIdAtPoint(input: {
  nodes: readonly CanvasNodeBoxLike[]
  point: CanvasConnectionPoint
  excludeNodeId?: string
}): string | null {
  let best: { id: string; z: number } | null = null

  for (const node of input.nodes) {
    if (node.id === input.excludeNodeId) continue
    const width = finiteNonNegative(node.measured?.width ?? node.width ?? 0, 0)
    const height = finiteNonNegative(node.measured?.height ?? node.height ?? 0, 0)
    const x = node.internals.positionAbsolute.x
    const y = node.internals.positionAbsolute.y
    if (width <= 0 || height <= 0) continue
    if (input.point.x < x || input.point.x > x + width) continue
    if (input.point.y < y || input.point.y > y + height) continue

    const z = typeof node.internals.z === 'number' ? node.internals.z : 0
    if (!best || z > best.z) best = { id: node.id, z }
  }

  return best?.id ?? null
}
