import { isStoryNodeType } from '@/lib/interactive/compile'

/** Custom async-clipboard format ("web " prefix) that carries copied canvas nodes and wires. */
export const CANVAS_CLIPBOARD_MIME = 'web application/x-nori-canvas+json'

export type CanvasClipboardDocumentLike<N extends ClipboardNodeLike = ClipboardNodeLike, E = unknown> = { nodes: N[]; edges: E[] }

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

const CANVAS_CLIPBOARD_SESSION_KEY = 'nori:canvas-clipboard:v1'
const CANVAS_CLIPBOARD_SESSION_MAX = 1_000_000

type CanvasClipboardStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/** Session persistence covers chapter navigation and full reloads without making a copy permanent. */
export function persistCanvasClipboard<N extends ClipboardNodeLike, E>(
  document: CanvasClipboardDocumentLike<N, E>,
  internalCopyText: string | null = null,
  storage: CanvasClipboardStorage | null | undefined = typeof sessionStorage === 'undefined' ? null : sessionStorage,
): void {
  if (!storage) return
  try {
    const raw = JSON.stringify({ ...document, internalCopyText })
    if (raw.length <= CANVAS_CLIPBOARD_SESSION_MAX) storage.setItem(CANVAS_CLIPBOARD_SESSION_KEY, raw)
    else storage.removeItem(CANVAS_CLIPBOARD_SESSION_KEY)
  } catch {
    // Quota and privacy failures leave the in-memory clipboard usable.
  }
}

export function readPersistedCanvasClipboard<N extends ClipboardNodeLike, E>(
  storage: Pick<CanvasClipboardStorage, 'getItem'> | null | undefined = typeof sessionStorage === 'undefined' ? null : sessionStorage,
): CanvasClipboardDocumentLike<N, E> | null {
  if (!storage) return null
  try {
    const raw = storage.getItem(CANVAS_CLIPBOARD_SESSION_KEY)
    if (!raw || raw.length > CANVAS_CLIPBOARD_SESSION_MAX) return null
    return parseCanvasClipboardDocument<N, E>(raw)
  } catch {
    return null
  }
}

export function readPersistedCanvasClipboardText(
  storage: Pick<CanvasClipboardStorage, 'getItem'> | null | undefined = typeof sessionStorage === 'undefined' ? null : sessionStorage,
): string | null {
  if (!storage) return null
  try {
    const raw = storage.getItem(CANVAS_CLIPBOARD_SESSION_KEY)
    if (!raw || raw.length > CANVAS_CLIPBOARD_SESSION_MAX) return null
    const value = JSON.parse(raw) as { internalCopyText?: unknown }
    return typeof value.internalCopyText === 'string' ? value.internalCopyText : null
  } catch {
    return null
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
