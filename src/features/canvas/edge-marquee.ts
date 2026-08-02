export type ScreenPoint = { x: number; y: number }
export type ScreenRect = { left: number; top: number; right: number; bottom: number }

export function normalizeScreenRect(start: ScreenPoint, end: ScreenPoint, padding = 0): ScreenRect {
  return {
    left: Math.min(start.x, end.x) - padding,
    top: Math.min(start.y, end.y) - padding,
    right: Math.max(start.x, end.x) + padding,
    bottom: Math.max(start.y, end.y) + padding,
  }
}

/**
 * A marquee should be more forgiving than full containment without selecting
 * a node from a one-pixel brush. Capture the node when its visual centre is in
 * the marquee, or when both axes and at least 14% of its body overlap.
 */
export function screenRectSelectsNode(selection: ScreenRect, node: ScreenRect) {
  const width = Math.max(0, node.right - node.left)
  const height = Math.max(0, node.bottom - node.top)
  if (width === 0 || height === 0) return false
  const overlapWidth = Math.max(0, Math.min(selection.right, node.right) - Math.max(selection.left, node.left))
  const overlapHeight = Math.max(0, Math.min(selection.bottom, node.bottom) - Math.max(selection.top, node.top))
  if (overlapWidth === 0 || overlapHeight === 0) return false

  const center = { x: node.left + width / 2, y: node.top + height / 2 }
  if (pointInsideRect(center, selection)) return true
  const overlapRatio = (overlapWidth * overlapHeight) / (width * height)
  const minimumWidth = Math.min(24, width * 0.18)
  const minimumHeight = Math.min(24, height * 0.18)
  return overlapRatio >= 0.14
    && overlapWidth >= minimumWidth
    && overlapHeight >= minimumHeight
}

/** Group frames are deliberately excluded: box selection targets their content. */
export function findCanvasNodeIdsIntersectingRect(container: Element, rect: ScreenRect): string[] {
  const ids: string[] = []
  const elements = container.querySelectorAll<HTMLElement>('.react-flow__node[data-id]')
  elements.forEach((element) => {
    const id = element.dataset.id?.trim()
    const isGroup = element.classList.contains('react-flow__node-group')
      || Boolean(element.querySelector('.nori-canvas-group'))
    if (!id || isGroup) return
    const bounds = element.getBoundingClientRect()
    if (screenRectSelectsNode(rect, {
      left: bounds.left,
      top: bounds.top,
      right: bounds.right,
      bottom: bounds.bottom,
    })) ids.push(id)
  })
  return ids
}

function pointInsideRect(point: ScreenPoint, rect: ScreenRect) {
  return point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom
}

function orientation(a: ScreenPoint, b: ScreenPoint, c: ScreenPoint) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
}

function pointOnSegment(point: ScreenPoint, a: ScreenPoint, b: ScreenPoint) {
  const epsilon = 0.001
  return Math.abs(orientation(a, b, point)) <= epsilon
    && point.x >= Math.min(a.x, b.x) - epsilon
    && point.x <= Math.max(a.x, b.x) + epsilon
    && point.y >= Math.min(a.y, b.y) - epsilon
    && point.y <= Math.max(a.y, b.y) + epsilon
}

function segmentsIntersect(a: ScreenPoint, b: ScreenPoint, c: ScreenPoint, d: ScreenPoint) {
  const abC = orientation(a, b, c)
  const abD = orientation(a, b, d)
  const cdA = orientation(c, d, a)
  const cdB = orientation(c, d, b)
  if (((abC > 0 && abD < 0) || (abC < 0 && abD > 0))
    && ((cdA > 0 && cdB < 0) || (cdA < 0 && cdB > 0))) return true
  return pointOnSegment(c, a, b)
    || pointOnSegment(d, a, b)
    || pointOnSegment(a, c, d)
    || pointOnSegment(b, c, d)
}

export function polylineIntersectsRect(points: ScreenPoint[], rect: ScreenRect) {
  if (points.length === 0) return false
  if (points.some((point) => pointInsideRect(point, rect))) return true
  const corners = [
    { x: rect.left, y: rect.top },
    { x: rect.right, y: rect.top },
    { x: rect.right, y: rect.bottom },
    { x: rect.left, y: rect.bottom },
  ]
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1]
    const b = points[index]
    for (let side = 0; side < corners.length; side += 1) {
      if (segmentsIntersect(a, b, corners[side], corners[(side + 1) % corners.length])) return true
    }
  }
  return false
}

function screenPoint(path: SVGPathElement, point: DOMPoint): ScreenPoint | null {
  const matrix = path.getScreenCTM()
  if (!matrix) return null
  return {
    x: matrix.a * point.x + matrix.c * point.y + matrix.e,
    y: matrix.b * point.x + matrix.d * point.y + matrix.f,
  }
}

export function findSvgEdgeIdsIntersectingRect(container: Element, rect: ScreenRect): string[] {
  const ids: string[] = []
  const groups = container.querySelectorAll<SVGGElement>('.react-flow__edge[data-id]')
  groups.forEach((group) => {
    const id = group.dataset.id?.trim()
    const path = group.querySelector<SVGPathElement>('path.react-flow__edge-path')
    if (!id || !path) return
    let length = 0
    try {
      length = path.getTotalLength()
    } catch {
      return
    }
    if (!Number.isFinite(length) || length <= 0) return
    const steps = Math.max(12, Math.min(180, Math.ceil(length / 12)))
    const points: ScreenPoint[] = []
    for (let index = 0; index <= steps; index += 1) {
      const point = screenPoint(path, path.getPointAtLength((length * index) / steps))
      if (point) points.push(point)
    }
    if (polylineIntersectsRect(points, rect)) ids.push(id)
  })
  return ids
}
