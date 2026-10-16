export const CANVAS_GENERATOR_PANEL_WIDTH_STORAGE_KEY = 'nori.canvas.generator-panel-width'
export const CANVAS_GENERATOR_PANEL_WIDTH_DEFAULT = 560
export const CANVAS_GENERATOR_PANEL_WIDTH_MIN = 360
export const CANVAS_GENERATOR_PANEL_WIDTH_MAX = 1_280

export function clampCanvasGeneratorPanelWidth(value: unknown, viewportWidth: number): number {
  const availableWidth = Math.max(280, Math.floor(viewportWidth) - 32)
  const maximum = Math.min(CANVAS_GENERATOR_PANEL_WIDTH_MAX, availableWidth)
  const minimum = Math.min(CANVAS_GENERATOR_PANEL_WIDTH_MIN, maximum)
  const numeric = value === null || value === undefined || value === ''
    ? Number.NaN
    : typeof value === 'number' ? value : Number(value)
  const preferred = Number.isFinite(numeric) ? numeric : CANVAS_GENERATOR_PANEL_WIDTH_DEFAULT
  return Math.round(Math.max(minimum, Math.min(maximum, preferred)))
}

export function resizeCanvasGeneratorPanelWidth(input: {
  startWidth: number
  startClientX: number
  clientX: number
  viewportWidth: number
  interfaceScale?: number
}): number {
  // The generator is anchored by its center to the selected node, so resizing
  // the right edge changes both visual sides while preserving that attachment.
  const scale = input.interfaceScale && input.interfaceScale > 0 ? input.interfaceScale : 1
  const centeredDelta = (input.clientX - input.startClientX) * 2 / scale
  return clampCanvasGeneratorPanelWidth(input.startWidth + centeredDelta, input.viewportWidth)
}
