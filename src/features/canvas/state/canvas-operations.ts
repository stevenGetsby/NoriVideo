import type {
  CanvasDocumentInput,
  CanvasEdge,
  CanvasGeometryUpdate,
  CanvasGraphDelta,
  CanvasGraphResponse,
  CanvasNode,
  CanvasOperation,
  Viewport,
} from '../types'
import { CANVAS_DOCUMENT_SCHEMA_VERSION } from '@/lib/canvas/document-version'
import { projectCanvasNodeCardData } from '@/lib/canvas/graph-summary'

function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const serialized = JSON.stringify(value)
    return serialized === undefined ? 'undefined' : serialized
  }
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  const source = value as Record<string, unknown>
  return `{${Object.keys(source).sort().map((key) => `${JSON.stringify(key)}:${stable(source[key])}`).join(',')}}`
}

function equal(left: unknown, right: unknown): boolean {
  return left === right || stable(left) === stable(right)
}

export function withoutCanvasId<T extends { canvasId: string }>(value: T): Omit<T, 'canvasId'> {
  const { canvasId, ...output } = value
  void canvasId
  return output
}

export function canvasGraphToDocument(
  graph: CanvasGraphResponse,
  clientId: string,
  changeSummary: string | null = null,
): CanvasDocumentInput {
  return {
    schema_version: CANVAS_DOCUMENT_SCHEMA_VERSION,
    expectedRevision: graph.canvas.revision,
    clientId,
    changeSummary,
    viewport: graph.canvas.viewport || { x: 0, y: 0, zoom: 1 },
    nodes: graph.nodes,
    edges: graph.edges,
  }
}

/**
 * Rebuilds the server-confirmed document from a save response that only carried
 * the nodes and edges the server actually wrote. The confirmed document stays
 * complete, so `buildCanvasOperations` keeps diffing against the whole graph.
 */
export function applyCanvasDocumentDelta(
  confirmed: CanvasDocumentInput,
  delta: CanvasGraphDelta,
  clientId: string,
  changeSummary: string | null,
): CanvasDocumentInput {
  if (
    delta.nodes.length === 0
    && delta.edges.length === 0
    && delta.deletedNodeIds.length === 0
    && delta.deletedEdgeIds.length === 0
    && !delta.geometry?.length
  ) {
    const next: CanvasDocumentInput = {
      ...confirmed,
      expectedRevision: delta.canvas.revision,
      clientId,
      changeSummary,
      viewport: delta.canvas.viewport || confirmed.viewport,
    }
    const index = indexCache.get(confirmed)
    if (index) indexCache.set(next, index)
    return next
  }
  const nodes = new Map(confirmed.nodes.map((node) => [node.id, node]))
  for (const id of delta.deletedNodeIds) nodes.delete(id)
  for (const node of delta.nodes) nodes.set(node.id, node)
  for (const update of delta.geometry ?? []) {
    const existing = nodes.get(update.id)
    if (!existing) continue
    nodes.set(update.id, {
      ...existing,
      ...(update.position ? { position: update.position } : {}),
      ...(update.size ? { size: update.size } : {}),
    })
  }
  const edges = new Map(confirmed.edges.map((edge) => [edge.id, edge]))
  for (const id of delta.deletedEdgeIds) edges.delete(id)
  for (const edge of delta.edges) edges.set(edge.id, edge)
  return {
    schema_version: CANVAS_DOCUMENT_SCHEMA_VERSION,
    expectedRevision: delta.canvas.revision,
    clientId,
    changeSummary,
    viewport: delta.canvas.viewport || confirmed.viewport,
    nodes: Array.from(nodes.values()),
    edges: Array.from(edges.values()),
  }
}

type ConfirmedIndex = { nodes: Map<string, CanvasNode>; edges: Map<string, CanvasEdge> }
const indexCache = new WeakMap<CanvasDocumentInput, ConfirmedIndex>()

function confirmedIndex(document: CanvasDocumentInput): ConfirmedIndex {
  let index = indexCache.get(document)
  if (!index) {
    index = {
      nodes: new Map(document.nodes.map((node) => [node.id, node])),
      edges: new Map(document.edges.map((edge) => [edge.id, edge])),
    }
    indexCache.set(document, index)
  }
  return index
}

/**
 * The entities that changed since the last confirmed save. Anything not listed is
 * known to equal the confirmed document, so the diff never serializes it.
 */
export type CanvasChangeBatch = {
  epoch: number
  viewport?: Viewport
  dirtyNodeIds: readonly string[]
  removedNodeIds: readonly string[]
  dirtyEdgeIds: readonly string[]
  removedEdgeIds: readonly string[]
}

export type CanvasCurrentView = {
  viewport: Viewport
  node(id: string): CanvasNode | undefined
  edge(id: string): CanvasEdge | undefined
}

function currentView(current: CanvasDocumentInput | CanvasCurrentView): CanvasCurrentView {
  if (!('nodes' in current)) return current
  const index = confirmedIndex(current)
  return { viewport: current.viewport, node: (id) => index.nodes.get(id), edge: (id) => index.edges.get(id) }
}

export type CanvasOperationBuildOptions = {
  /** Express a move or resize as `node.update_geometry` instead of rewriting the whole node. */
  geometryOps?: boolean
}

type NodeComparison = 'same' | 'changed' | { geometry: CanvasGeometryUpdate }

function hasSameCardFields(before: CanvasNode['data'], after: CanvasNode['data']): boolean {
  if (before === after) return true
  if (!before || !after) return false
  const left = before as Record<string, unknown>
  const right = after as Record<string, unknown>
  let leftCount = 0
  for (const key of Object.keys(left)) {
    if (key === '__canvasUnhydrated') continue
    if (!Object.hasOwn(right, key) || left[key] !== right[key]) return false
    leftCount++
  }
  return leftCount === Object.keys(right).length - Number(Object.hasOwn(right, '__canvasUnhydrated'))
}

function compareNodes(before: CanvasNode, next: CanvasNode, geometryOps: boolean): NodeComparison {
  if (!geometryOps) return equal(withoutCanvasId(before), withoutCanvasId(next)) ? 'same' : 'changed'
  const beforeSummary = before.data?.__canvasUnhydrated === true
  const nextSummary = next.data?.__canvasUnhydrated === true
  if (beforeSummary && !nextSummary) return 'changed'
  const keys = new Set([...Object.keys(before), ...Object.keys(next)])
  for (const key of ['canvasId', 'position', 'size', 'detailVersion', 'historyCount']) keys.delete(key)
  const left = before as unknown as Record<string, unknown>
  const right = next as unknown as Record<string, unknown>
  for (const key of keys) {
    if (key === 'data' && nextSummary) {
      // Transport summaries omit heavy fields, but generation settings and
      // other editable card fields must still trigger a hydrated body write.
      if (!hasSameCardFields(before.data, next.data)
        && !equal(projectCanvasNodeCardData(before.data), projectCanvasNodeCardData(next.data))) return 'changed'
    } else if (!equal(left[key], right[key])) return 'changed'
  }
  const movedPosition = !equal(before.position, next.position)
  const movedSize = !equal(before.size, next.size)
  if (!movedPosition && !movedSize) return 'same'
  if (movedSize && !next.size) return 'changed'
  return {
    geometry: {
      id: next.id,
      ...(movedPosition ? { position: next.position } : {}),
      ...(movedSize && next.size ? { size: next.size } : {}),
    },
  }
}

function upsertPayload(node: CanvasNode) {
  const { detailVersion, ...rest } = withoutCanvasId(node) as Omit<CanvasNode, 'canvasId'> & { detailVersion?: unknown }
  void detailVersion
  return rest as Omit<CanvasNode, 'canvasId'>
}

function nodeOperationFor(before: CanvasNode | undefined, next: CanvasNode, geometryOps: boolean): CanvasOperation | null {
  if (!before) return { type: 'node.upsert', node: upsertPayload(next) }
  if (next.data?.__canvasUnhydrated === true && !geometryOps) throw new Error(`节点 ${next.id} 尚未加载完整内容，请先加载后再保存。`)
  const comparison = compareNodes(before, next, geometryOps)
  if (comparison === 'same') return null
  if (comparison === 'changed') return { type: 'node.upsert', node: upsertPayload(next) }
  return { type: 'node.update_geometry', ...comparison.geometry }
}

/**
 * Same operations as `buildCanvasOperations`, but only the entities named in `changes`
 * are compared, so the cost follows the edit instead of the canvas size.
 */
export function buildCanvasOperationsFromChanges(
  confirmed: CanvasDocumentInput,
  current: CanvasDocumentInput | CanvasCurrentView,
  changes: CanvasChangeBatch,
  options: CanvasOperationBuildOptions = {},
): CanvasOperation[] {
  const operations: CanvasOperation[] = []
  const geometryOps = options.geometryOps === true
  const view = currentView(current)
  const previous = confirmedIndex(confirmed)
  const dirtyNodes = new Set(changes.dirtyNodeIds)
  const dirtyEdges = new Set(changes.dirtyEdgeIds)

  for (const id of changes.removedEdgeIds) {
    if (previous.edges.has(id) && !dirtyEdges.has(id)) operations.push({ type: 'edge.delete', id })
  }
  for (const id of changes.dirtyEdgeIds) {
    const before = previous.edges.get(id)
    const next = view.edge(id)
    if (before && (!next || !equal(withoutCanvasId(before), withoutCanvasId(next)))) operations.push({ type: 'edge.delete', id })
  }
  for (const id of changes.removedNodeIds) {
    if (previous.nodes.has(id) && !dirtyNodes.has(id)) operations.push({ type: 'node.delete', id })
  }
  for (const id of changes.dirtyNodeIds) {
    const next = view.node(id)
    if (!next) {
      if (previous.nodes.has(id)) operations.push({ type: 'node.delete', id })
      continue
    }
    const operation = nodeOperationFor(previous.nodes.get(id), next, geometryOps)
    if (operation) operations.push(operation)
  }
  for (const id of changes.dirtyEdgeIds) {
    const next = view.edge(id)
    if (!next) continue
    const before = previous.edges.get(id)
    if (!before || !equal(withoutCanvasId(before), withoutCanvasId(next))) {
      operations.push({ type: 'edge.add', edge: withoutCanvasId(next) })
    }
  }
  const viewport = changes.viewport ?? view.viewport
  if (!equal(confirmed.viewport, viewport)) operations.push({ type: 'canvas.update_meta', viewport })
  return operations
}

function operationKey(operation: CanvasOperation) {
  if (operation.type === 'node.upsert') return `node.upsert:${operation.node.id}`
  if (operation.type === 'edge.add') return `edge.add:${operation.edge.id}`
  if (operation.type === 'canvas.update_meta') return operation.type
  return `${operation.type}:${operation.id}`
}

/** Whether two operation lists touch the same entities the same number of times, ignoring order. */
export function sameOperationTargets(left: readonly CanvasOperation[], right: readonly CanvasOperation[]) {
  if (left.length !== right.length) return false
  const remaining = new Map<string, number>()
  for (const operation of left) {
    const key = operationKey(operation)
    remaining.set(key, (remaining.get(key) ?? 0) + 1)
  }
  for (const operation of right) {
    const key = operationKey(operation)
    const count = remaining.get(key)
    if (!count) return false
    remaining.set(key, count - 1)
  }
  return true
}

/**
 * A full current document is compared with the last server-confirmed graph.
 * This naturally collapses hundreds of drag/change events into one final
 * upsert per entity without maintaining a second mutable operation queue.
 */
export function buildCanvasOperations(
  confirmed: CanvasDocumentInput,
  current: CanvasDocumentInput,
  options: CanvasOperationBuildOptions = {},
): CanvasOperation[] {
  const operations: CanvasOperation[] = []
  const geometryOps = options.geometryOps === true
  const previousNodes = new Map(confirmed.nodes.map((node) => [node.id, node]))
  const currentNodes = new Map(current.nodes.map((node) => [node.id, node]))
  const previousEdges = new Map(confirmed.edges.map((edge) => [edge.id, edge]))
  const currentEdges = new Map(current.edges.map((edge) => [edge.id, edge]))

  // Delete changed edges first so the same id can be re-added with new handles.
  for (const [id, edge] of previousEdges) {
    const next = currentEdges.get(id)
    if (!next || !equal(withoutCanvasId(edge), withoutCanvasId(next))) {
      operations.push({ type: 'edge.delete', id })
    }
  }
  for (const id of previousNodes.keys()) {
    if (!currentNodes.has(id)) operations.push({ type: 'node.delete', id })
  }
  for (const node of current.nodes) {
    const operation = nodeOperationFor(previousNodes.get(node.id), node, geometryOps)
    if (operation) operations.push(operation)
  }
  for (const edge of current.edges) {
    const previous = previousEdges.get(edge.id)
    if (!previous || !equal(withoutCanvasId(previous), withoutCanvasId(edge))) {
      operations.push({ type: 'edge.add', edge: withoutCanvasId(edge) })
    }
  }
  if (!equal(confirmed.viewport, current.viewport)) {
    operations.push({ type: 'canvas.update_meta', viewport: current.viewport })
  }
  return operations
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

export function isCanvasOperationArray(value: unknown): value is CanvasOperation[] {
  if (!Array.isArray(value)) return false
  return value.every((item) => {
    const source = record(item)
    if (!source || typeof source.type !== 'string') return false
    if (source.type === 'node.delete' || source.type === 'edge.delete') return typeof source.id === 'string' && Boolean(source.id)
    if (source.type === 'node.upsert') return Boolean(record(source.node)?.id)
    if (source.type === 'node.update_geometry') {
      return typeof source.id === 'string' && Boolean(source.id) && (Boolean(record(source.position)) || Boolean(record(source.size)))
    }
    if (source.type === 'edge.add') return Boolean(record(source.edge)?.id)
    if (source.type !== 'canvas.update_meta') return false
    return 'viewport' in source || 'title' in source || 'themeColor' in source
  })
}

export function canvasDocumentWithRevision(
  document: CanvasDocumentInput,
  revision: number,
  clientId: string,
): CanvasDocumentInput {
  return {
    ...document,
    expectedRevision: revision,
    clientId,
  }
}

/**
 * Applies a list of operations to a document. Used by offline recovery: the
 * server document is the base, and the local pending ops are replayed on top.
 * Operations whose target no longer exists are skipped, so a stale draft
 * cannot delete server-side nodes it does not know about.
 */
export function applyCanvasOperationsToDocument(
  document: CanvasDocumentInput,
  operations: readonly CanvasOperation[],
  clientId: string,
  changeSummary: string,
): CanvasDocumentInput {
  const nodes = new Map(document.nodes.map((node) => [node.id, node]))
  const edges = new Map(document.edges.map((edge) => [edge.id, edge]))
  let viewport = document.viewport
  for (const operation of operations) {
    switch (operation.type) {
      case 'canvas.update_meta':
        if (operation.viewport) viewport = operation.viewport
        break
      case 'node.upsert':
        nodes.set(operation.node.id, { ...operation.node, canvasId: document.nodes[0]?.canvasId ?? '' })
        break
      case 'node.delete':
        nodes.delete(operation.id)
        // Drop any edges that reference the deleted node.
        for (const [edgeId, edge] of edges) {
          if (edge.sourceNodeId === operation.id || edge.targetNodeId === operation.id) edges.delete(edgeId)
        }
        break
      case 'node.update_geometry': {
        const existing = nodes.get(operation.id)
        if (!existing) break
        nodes.set(operation.id, {
          ...existing,
          ...(operation.position ? { position: operation.position } : {}),
          ...(operation.size ? { size: operation.size } : {}),
        })
        break
      }
      case 'edge.add':
        edges.set(operation.edge.id, { ...operation.edge, canvasId: document.edges[0]?.canvasId ?? '' })
        break
      case 'edge.delete':
        edges.delete(operation.id)
        break
    }
  }
  return {
    ...document,
    expectedRevision: document.expectedRevision,
    clientId,
    changeSummary,
    viewport,
    nodes: Array.from(nodes.values()),
    edges: Array.from(edges.values()),
  }
}
