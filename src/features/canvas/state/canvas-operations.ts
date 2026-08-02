import type {
  CanvasDocumentInput,
  CanvasGraphResponse,
  CanvasOperation,
} from '../types'
import { CANVAS_DOCUMENT_SCHEMA_VERSION } from '@/lib/canvas/document-version'

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

function withoutCanvasId<T extends { canvasId: string }>(value: T): Omit<T, 'canvasId'> {
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
 * A full current document is compared with the last server-confirmed graph.
 * This naturally collapses hundreds of drag/change events into one final
 * upsert per entity without maintaining a second mutable operation queue.
 */
export function buildCanvasOperations(
  confirmed: CanvasDocumentInput,
  current: CanvasDocumentInput,
): CanvasOperation[] {
  const operations: CanvasOperation[] = []
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
    const previous = previousNodes.get(node.id)
    if (!previous || !equal(withoutCanvasId(previous), withoutCanvasId(node))) {
      operations.push({ type: 'node.upsert', node: withoutCanvasId(node) })
    }
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
