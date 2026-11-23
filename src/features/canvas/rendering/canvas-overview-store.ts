import type { CanvasRenderMode } from './canvas-render-budget'
import type { CanvasRenderProjection } from './canvas-viewport-index'

export type CanvasFoldedEdges = { count: number; ids: readonly string[]; exact: boolean }

export type CanvasOverviewSnapshot = {
  mode: CanvasRenderMode
  overview: CanvasRenderProjection['overview']
  folded: CanvasFoldedEdges
  version: number
}

// Pan/zoom must never go through React state, so the overview canvas reads this store and the React Flow transform directly.
export class CanvasOverviewStore {
  private snapshot: CanvasOverviewSnapshot | null = null
  private readonly listeners = new Set<() => void>()
  private version = 0

  get = (): CanvasOverviewSnapshot | null => this.snapshot

  set(mode: CanvasRenderMode, overview: CanvasRenderProjection['overview'], folded: CanvasFoldedEdges) {
    this.version += 1
    this.snapshot = { mode, overview, folded, version: this.version }
    for (const listener of this.listeners) listener()
  }

  clear() {
    if (!this.snapshot) return
    this.snapshot = null
    for (const listener of this.listeners) listener()
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
}
