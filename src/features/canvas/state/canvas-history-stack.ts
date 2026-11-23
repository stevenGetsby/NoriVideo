import type { CanvasFlowEdge, CanvasFlowNode } from '../editor-types'
import type { Viewport } from '../types'

export type CanvasEditorSnapshot = {
  nodes: CanvasFlowNode[]
  edges: CanvasFlowEdge[]
  viewport: Viewport
}

type HistoryEntry = { label: string; snapshot: CanvasEditorSnapshot; marker: symbol }

/**
 * Editor state is immutable, so an entry only needs its own arrays of references: untouched
 * nodes are shared between every entry and the live state instead of being deep-cloned.
 */
function share(snapshot: CanvasEditorSnapshot): CanvasEditorSnapshot {
  return { nodes: snapshot.nodes.slice(), edges: snapshot.edges.slice(), viewport: { ...snapshot.viewport } }
}

export function createCanvasHistoryStack(limit = 80) {
  let past: HistoryEntry[] = []
  let future: HistoryEntry[] = []

  return {
    record(label: string, current: CanvasEditorSnapshot) {
      past.push({ label, snapshot: share(current), marker: Symbol() })
      if (past.length > limit) past.splice(0, past.length - limit)
      future = []
    },
    undo(current: CanvasEditorSnapshot) {
      const entry = past.pop()
      if (!entry) return null
      future.push({ label: entry.label, snapshot: share(current), marker: entry.marker })
      return share(entry.snapshot)
    },
    redo(current: CanvasEditorSnapshot) {
      const entry = future.pop()
      if (!entry) return null
      past.push({ label: entry.label, snapshot: share(current), marker: Symbol() })
      return share(entry.snapshot)
    },
    reset() {
      past = []
      future = []
    },
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
    getDepth: () => past.length,
    getLastLabel: () => past.at(-1)?.label ?? null,
    getHead: () => past.at(-1)?.marker ?? null,
  }
}
