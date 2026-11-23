import type { CanvasChangeBatch } from './canvas-operations'

type Identified = { id: string }

type Baseline<N, E> = { nodes: Map<string, N>; edges: Map<string, E> }

export type CanvasTrackedBatch<N, E> = {
  changes: CanvasChangeBatch
  node(id: string): N | undefined
  edge(id: string): E | undefined
}

/**
 * Editor state is immutable, so an entity whose reference is unchanged since the last
 * reconciliation is guaranteed equal to what the server already confirmed. Detecting
 * edits is therefore a pointer comparison, and only the changed entities are ever
 * converted and serialized.
 */
export function createCanvasChangeTracker<N extends Identified, E extends Identified>() {
  let baseline: Baseline<N, E> | null = null
  let epoch = 0
  const pending = new WeakMap<CanvasChangeBatch, { nodes: Map<string, N>; edges: Map<string, E> }>()

  const snapshot = (nodes: readonly N[], edges: readonly E[]): Baseline<N, E> => ({
    nodes: new Map(nodes.map((node) => [node.id, node])),
    edges: new Map(edges.map((edge) => [edge.id, edge])),
  })

  function diff<T extends Identified>(items: readonly T[], known: Map<string, T>) {
    const dirty: string[] = []
    const changed = new Map<string, T>()
    let present = 0
    for (const item of items) {
      const previous = known.get(item.id)
      if (previous !== undefined) present += 1
      if (previous !== item) {
        dirty.push(item.id)
        changed.set(item.id, item)
      }
    }
    const removed: string[] = []
    if (present < known.size) {
      const ids = new Set(items.map((item) => item.id))
      for (const id of known.keys()) if (!ids.has(id)) removed.push(id)
    }
    return { dirty, removed, changed }
  }

  return {
    ready: () => baseline !== null,
    epoch: () => epoch,

    /** Forget the baseline; the next save compares the whole document once. */
    invalidate() {
      baseline = null
      epoch += 1
    },

    /** Adopt the given entities as already confirmed; a stale epoch means the baseline moved meanwhile. */
    reconcile(nodes: readonly N[], edges: readonly E[], expectedEpoch?: number) {
      if (expectedEpoch !== undefined && expectedEpoch !== epoch) return false
      baseline = snapshot(nodes, edges)
      epoch += 1
      return true
    },

    /** Loaded details are already server-confirmed; do not rebase unrelated edits. */
    confirmNodes(nodes: readonly N[], preserveGeometry = false) {
      if (!baseline) return false
      for (const node of nodes) {
        const previous = baseline.nodes.get(node.id)
        if (previous === node) continue
        if (preserveGeometry) {
          const current = node as N & { position?: unknown; width?: number; height?: number }
          const previousGeometry = previous as N & { position?: unknown; width?: number; height?: number } | undefined
          baseline.nodes.set(node.id, {
            ...current,
            position: previousGeometry?.position,
            ...('width' in current || (previousGeometry && 'width' in previousGeometry) ? { width: previousGeometry?.width } : {}),
            ...('height' in current || (previousGeometry && 'height' in previousGeometry) ? { height: previousGeometry?.height } : {}),
          })
        } else baseline.nodes.set(node.id, node)
      }
      return true
    },

    /** The entities whose reference changed since the baseline, or null without a baseline. */
    collect(nodes: readonly N[], edges: readonly E[]): CanvasTrackedBatch<N, E> | null {
      if (!baseline) return null
      const nodeDiff = diff(nodes, baseline.nodes)
      const edgeDiff = diff(edges, baseline.edges)
      const changes: CanvasChangeBatch = {
        epoch,
        dirtyNodeIds: nodeDiff.dirty,
        removedNodeIds: nodeDiff.removed,
        dirtyEdgeIds: edgeDiff.dirty,
        removedEdgeIds: edgeDiff.removed,
      }
      pending.set(changes, { nodes: nodeDiff.changed, edges: edgeDiff.changed })
      return {
        changes,
        node: (id) => nodeDiff.changed.get(id),
        edge: (id) => edgeDiff.changed.get(id),
      }
    },

    /** The batch is now confirmed (saved, or proven equal): advance the baseline past it. */
    commit(changes: CanvasChangeBatch) {
      const confirmed = pending.get(changes)
      pending.delete(changes)
      if (!baseline || changes.epoch !== epoch || !confirmed) return false
      for (const [id, node] of confirmed.nodes) baseline.nodes.set(id, node)
      for (const [id, edge] of confirmed.edges) baseline.edges.set(id, edge)
      for (const id of changes.removedNodeIds) baseline.nodes.delete(id)
      for (const id of changes.removedEdgeIds) baseline.edges.delete(id)
      return true
    },
  }
}

export type CanvasChangeTracker<N extends Identified, E extends Identified> = ReturnType<typeof createCanvasChangeTracker<N, E>>
