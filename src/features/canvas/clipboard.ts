export const CANVAS_CLIPBOARD_PREFIX = 'NORI_CANVAS:'

export type CanvasClipboardPasteSource =
  | 'system-media'
  | 'system-canvas'
  | 'system-text'
  | 'internal-canvas'
  | 'none'

export function isCanvasClipboardTextAvailable(value: string): boolean {
  const text = value.trim()
  if (!text) return false
  if (!text.startsWith(CANVAS_CLIPBOARD_PREFIX)) return true
  try {
    const payload = JSON.parse(text.slice(CANVAS_CLIPBOARD_PREFIX.length)) as { nodes?: unknown }
    return Array.isArray(payload.nodes) && payload.nodes.length > 0
  } catch {
    return false
  }
}

export function isCanvasClipboardMimeAvailable(types: readonly string[]): boolean {
  return types.some((type) => (
    type.startsWith('image/')
    || type.startsWith('video/')
    || type.startsWith('audio/')
    || type === 'model/gltf-binary'
  ))
}

export function resolveCanvasClipboardPasteSource(input: {
  hasSystemMedia: boolean
  systemTextReadable: boolean
  systemText: string
  hasInternalCanvas: boolean
}): CanvasClipboardPasteSource {
  if (input.hasSystemMedia) return 'system-media'
  if (input.systemTextReadable && input.systemText.startsWith(CANVAS_CLIPBOARD_PREFIX)) return 'system-canvas'
  if (input.systemTextReadable && input.systemText.trim()) return 'system-text'
  if (input.hasInternalCanvas) return 'internal-canvas'
  return 'none'
}
