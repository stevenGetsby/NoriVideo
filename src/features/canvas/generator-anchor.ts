export interface CanvasGeneratorAnchor {
  x: number
  y: number
  placement: 'above' | 'below'
  /** Horizontal attachment point inside the editor panel. */
  tetherX: number
  /** Gap between the editor edge and its bound node. */
  tetherLength: number
  /** Maximum visible panel height before its content becomes scrollable. */
  maxHeight: number
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value))
}

export function resolveCanvasGeneratorAnchor(input: {
  nodePosition: { x: number; y: number }
  nodeSize: { width: number; height: number }
  viewport: { x: number; y: number; zoom: number }
  surface: { width: number; height: number }
  panelWidth?: number
  minimumPanelHeight?: number
  gap?: number
  aboveGap?: number
  safeTop?: number
  safeBottom?: number
}): CanvasGeneratorAnchor {
  const zoom = Number.isFinite(input.viewport.zoom) && input.viewport.zoom > 0
    ? input.viewport.zoom
    : 1
  const gap = input.gap ?? 16
  // The selected-node action toolbar lives above the node. Reserve its full
  // height when the generator flips upward so neither surface covers the
  // other; the smaller ordinary gap remains appropriate below the node.
  const aboveGap = input.aboveGap ?? 68
  const panelWidth = Math.min(input.panelWidth ?? 840, Math.max(240, input.surface.width - 80))
  const halfPanel = panelWidth / 2
  const nodeCenterX = input.viewport.x + (input.nodePosition.x + input.nodeSize.width / 2) * zoom
  const x = input.surface.width <= panelWidth + 80
    ? input.surface.width / 2
    : Math.min(input.surface.width - halfPanel - 40, Math.max(halfPanel + 40, nodeCenterX))
  const nodeTop = input.viewport.y + input.nodePosition.y * zoom
  const nodeBottom = nodeTop + input.nodeSize.height * zoom
  const minimumPanelHeight = input.minimumPanelHeight ?? 430
  const safeTop = Math.max(0, input.safeTop ?? 116)
  const safeBottom = Math.max(0, input.safeBottom ?? 28)
  const availableSurfaceHeight = Math.max(120, input.surface.height - safeTop - safeBottom)
  const minimumVisiblePanelHeight = Math.min(340, availableSurfaceHeight)
  const belowStart = nodeBottom + gap
  const aboveEnd = nodeTop - aboveGap
  const belowSpace = Math.max(0, input.surface.height - safeBottom - Math.max(safeTop, belowStart))
  const aboveSpace = Math.max(0, Math.min(input.surface.height - safeBottom, aboveEnd) - safeTop)
  const placement: CanvasGeneratorAnchor['placement'] = belowSpace >= minimumPanelHeight
    ? 'below'
    : aboveSpace >= minimumPanelHeight
      ? 'above'
      : belowSpace >= aboveSpace ? 'below' : 'above'
  const y = placement === 'below'
    ? clamp(belowStart, safeTop, Math.max(safeTop, input.surface.height - safeBottom - minimumVisiblePanelHeight))
    : clamp(aboveEnd, Math.min(input.surface.height - safeBottom, safeTop + minimumVisiblePanelHeight), input.surface.height - safeBottom)
  const maxHeight = placement === 'below'
    ? Math.max(minimumVisiblePanelHeight, input.surface.height - safeBottom - y)
    : Math.max(minimumVisiblePanelHeight, y - safeTop)
  const tetherX = clamp(nodeCenterX - (x - halfPanel), 28, panelWidth - 28)
  const tetherLength = placement === 'below'
    ? Math.max(8, y - nodeBottom)
    : Math.max(8, nodeTop - y)

  return {
    x: Math.round(x),
    y: Math.round(y),
    placement,
    tetherX: Math.round(tetherX),
    tetherLength: Math.round(tetherLength),
    maxHeight: Math.round(maxHeight),
  }
}
