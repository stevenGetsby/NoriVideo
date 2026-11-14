import { isStoryNodeType } from '@/lib/interactive/compile'

/** Custom async-clipboard format ("web " prefix) that carries copied canvas nodes and wires. */
export const CANVAS_CLIPBOARD_MIME = 'web application/x-nori-canvas+json'

export type CanvasClipboardPasteSource =
  | 'system-canvas'
  | 'system-media'
  | 'internal-canvas'
  | 'system-text'
  | 'none'

type ClipboardNodeLike = { id: string; position: { x: number; y: number } }
type ClipboardTextNodeLike = { type?: string; data?: { text?: unknown; mediaType?: unknown; [key: string]: unknown } | null }

export function isCanvasClipboardTextAvailable(value: string): boolean {
  return value.trim().length > 0
}

/**
 * Plain canvases never accept story nodes, including ones copied from a story
 * chapter. Wires touching a removed node go with it.
 */
export function filterStoryClipboardDocument<N extends { id: string; type?: string }, E extends { source: string; target: string }>(
  nodes: readonly N[],
  edges: readonly E[],
  allowStory: boolean,
): { nodes: N[]; edges: E[]; filtered: boolean } {
  if (allowStory) return { nodes: [...nodes], edges: [...edges], filtered: false }
  const kept = nodes.filter((node) => !isStoryNodeType(node.type))
  if (kept.length === nodes.length) return { nodes: [...nodes], edges: [...edges], filtered: false }
  const ids = new Set(kept.map((node) => node.id))
  return {
    nodes: kept,
    edges: edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)),
    filtered: true,
  }
}

export function hasCanvasClipboardMime(types: readonly string[]): boolean {
  return types.includes(CANVAS_CLIPBOARD_MIME)
}

export function isCanvasClipboardMimeAvailable(types: readonly string[]): boolean {
  return types.some((type) => (
    type.startsWith('image/')
    || type.startsWith('video/')
    || type.startsWith('audio/')
    || type === 'model/gltf-binary'
  ))
}

/** The plain-text flavour of a copy: only the body of the copied text nodes. */
export function collectCanvasClipboardText(nodes: readonly ClipboardTextNodeLike[]): string {
  return nodes
    .filter((node) => node.type === 'text' || node.type === 'note' || node.data?.mediaType === 'text')
    .map((node) => (typeof node.data?.text === 'string' ? node.data.text.trim() : ''))
    .filter(Boolean)
    .join('\n\n')
}

export function parseCanvasClipboardDocument<N extends ClipboardNodeLike, E>(raw: string): { nodes: N[]; edges: E[] } | null {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  if (!value || typeof value !== 'object') return null
  const { nodes, edges } = value as { nodes?: unknown; edges?: unknown }
  if (!Array.isArray(nodes) || nodes.length === 0) return null
  const wellFormed = nodes.every((node) => (
    node
    && typeof node === 'object'
    && typeof (node as ClipboardNodeLike).id === 'string'
    && Number.isFinite((node as ClipboardNodeLike).position?.x)
    && Number.isFinite((node as ClipboardNodeLike).position?.y)
  ))
  if (!wellFormed) return null
  return { nodes: nodes as N[], edges: Array.isArray(edges) ? edges as E[] : [] }
}

/**
 * Writes the canvas data in its own clipboard format next to a plain-text flavour.
 * `canvasFormat` is false when the browser refused the custom format and only text was written.
 */
export async function writeCanvasClipboard(documentJson: string, plainText: string): Promise<{ canvasFormat: boolean }> {
  const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard
  if (!clipboard) return { canvasFormat: false }
  try {
    const entries: Record<string, Blob> = {
      [CANVAS_CLIPBOARD_MIME]: new Blob([documentJson], { type: CANVAS_CLIPBOARD_MIME }),
    }
    if (plainText) entries['text/plain'] = new Blob([plainText], { type: 'text/plain' })
    await clipboard.write([new ClipboardItem(entries)])
    return { canvasFormat: true }
  } catch {
    await clipboard.writeText(plainText).catch(() => undefined)
    return { canvasFormat: false }
  }
}

export function resolveCanvasClipboardPasteSource(input: {
  hasSystemCanvas: boolean
  hasSystemMedia: boolean
  systemTextReadable: boolean
  systemText: string
  hasInternalCanvas: boolean
  /**
   * Set only when the last copy could not store the custom format: the system clipboard then holds
   * just the plain text of that copy, which still identifies it as our own canvas copy.
   */
  internalCopyText: string | null
}): CanvasClipboardPasteSource {
  if (input.hasSystemCanvas) return 'system-canvas'
  if (input.hasSystemMedia) return 'system-media'
  const text = input.systemTextReadable ? input.systemText : ''
  if (input.hasInternalCanvas && input.internalCopyText !== null && text.trim() === input.internalCopyText.trim()) return 'internal-canvas'
  if (text.trim()) return 'system-text'
  if (input.hasInternalCanvas) return 'internal-canvas'
  return 'none'
}
