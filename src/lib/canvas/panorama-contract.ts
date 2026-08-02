export const CANVAS_PANORAMA_PROCESS_TYPE = 'panorama_720' as const

export function isCanvasPanoramaProcessType(
  value: unknown,
): value is typeof CANVAS_PANORAMA_PROCESS_TYPE {
  return typeof value === 'string' && value.trim() === CANVAS_PANORAMA_PROCESS_TYPE
}
