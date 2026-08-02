import {
  MAX_CANVAS_DOCUMENT_BYTES,
  parseCanvasDocumentEdgeInput,
  parseCanvasDocumentNodeInput,
  type CanvasDocumentEdgeInput,
  type CanvasDocumentNodeInput,
} from './document'

export const MAX_CANVAS_OPERATIONS = 12_000
export const MAX_CANVAS_OPERATIONS_BYTES = MAX_CANVAS_DOCUMENT_BYTES

export type CanvasUpdateMetaOperation = {
  type: 'canvas.update_meta'
  title?: string
  themeColor?: string | null
  viewport?: { x: number; y: number; zoom: number }
}

export type CanvasOperation =
  | { type: 'node.upsert'; node: CanvasDocumentNodeInput }
  | { type: 'node.delete'; id: string }
  | { type: 'edge.add'; edge: CanvasDocumentEdgeInput }
  | { type: 'edge.delete'; id: string }
  | CanvasUpdateMetaOperation

export type CanvasOperationsSaveInput = {
  expectedRevision: number
  clientId: string
  changeSummary: string | null
  ops: CanvasOperation[]
}

export type CanvasOperationsValidationError = {
  code: 'CANVAS_OPERATIONS_INVALID' | 'CANVAS_OPERATIONS_TOO_LARGE'
  message: string
  actualBytes?: number
  maxBytes?: number
}

export type CanvasOperationsValidationResult =
  | { success: true; data: CanvasOperationsSaveInput }
  | { success: false; error: CanvasOperationsValidationError }

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function hasOnlyKeys(source: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys)
  return Object.keys(source).every((key) => allowed.has(key))
}

function cleanString(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed && trimmed.length <= max ? trimmed : null
}

function parseViewport(value: unknown): { x: number; y: number; zoom: number } | null {
  const source = record(value)
  if (!source || !hasOnlyKeys(source, ['x', 'y', 'zoom'])) return null
  const { x, y, zoom } = source
  if (
    typeof x !== 'number' || !Number.isFinite(x) || Math.abs(x) > 10_000_000
    || typeof y !== 'number' || !Number.isFinite(y) || Math.abs(y) > 10_000_000
    || typeof zoom !== 'number' || !Number.isFinite(zoom) || zoom < 0.05 || zoom > 8
  ) return null
  return { x, y, zoom }
}

function parseNodeOperation(source: Record<string, unknown>): CanvasOperation | null {
  if (source.type === 'node.delete') {
    if (!hasOnlyKeys(source, ['type', 'id'])) return null
    const id = cleanString(source.id, 191)
    return id ? { type: 'node.delete', id } : null
  }
  if (!hasOnlyKeys(source, ['type', 'node'])) return null
  const rawNode = record(source.node)
  if (!rawNode || !hasOnlyKeys(rawNode, [
    'id', 'type', 'position', 'size', 'data', 'status', 'taskId', 'runId', 'mediaObjectId', 'parentNodeId',
  ])) return null
  const node = parseCanvasDocumentNodeInput(rawNode)
  return node ? { type: 'node.upsert', node } : null
}

function parseEdgeOperation(source: Record<string, unknown>): CanvasOperation | null {
  if (source.type === 'edge.delete') {
    if (!hasOnlyKeys(source, ['type', 'id'])) return null
    const id = cleanString(source.id, 191)
    return id ? { type: 'edge.delete', id } : null
  }
  if (!hasOnlyKeys(source, ['type', 'edge'])) return null
  const rawEdge = record(source.edge)
  if (!rawEdge || !hasOnlyKeys(rawEdge, [
    'id', 'sourceNodeId', 'targetNodeId', 'sourceHandle', 'targetHandle', 'role',
  ])) return null
  const edge = parseCanvasDocumentEdgeInput(rawEdge)
  return edge ? { type: 'edge.add', edge } : null
}

function parseMetaOperation(source: Record<string, unknown>): CanvasUpdateMetaOperation | null {
  if (!hasOnlyKeys(source, ['type', 'title', 'themeColor', 'viewport'])) return null
  const output: CanvasUpdateMetaOperation = { type: 'canvas.update_meta' }
  if ('title' in source) {
    const title = cleanString(source.title, 120)
    if (!title) return null
    output.title = title
  }
  if ('themeColor' in source) {
    if (source.themeColor === null) output.themeColor = null
    else {
      const themeColor = cleanString(source.themeColor, 32)
      if (!themeColor) return null
      output.themeColor = themeColor
    }
  }
  if ('viewport' in source) {
    const viewport = parseViewport(source.viewport)
    if (!viewport) return null
    output.viewport = viewport
  }
  return Object.keys(output).length > 1 ? output : null
}

function parseOperation(value: unknown): CanvasOperation | null {
  const source = record(value)
  if (!source || typeof source.type !== 'string') return null
  if (source.type === 'node.upsert' || source.type === 'node.delete') return parseNodeOperation(source)
  if (source.type === 'edge.add' || source.type === 'edge.delete') return parseEdgeOperation(source)
  if (source.type === 'canvas.update_meta') return parseMetaOperation(source)
  return null
}

function serializedByteLength(value: unknown): number | null {
  try {
    const serialized = JSON.stringify(value)
    return typeof serialized === 'string' ? Buffer.byteLength(serialized, 'utf8') : null
  } catch {
    return null
  }
}

export function validateCanvasOperationsSaveInput(value: unknown): CanvasOperationsValidationResult {
  const actualBytes = serializedByteLength(value)
  if (actualBytes === null) {
    return { success: false, error: { code: 'CANVAS_OPERATIONS_INVALID', message: '画布操作批次无法序列化。' } }
  }
  if (actualBytes > MAX_CANVAS_OPERATIONS_BYTES) {
    return {
      success: false,
      error: {
        code: 'CANVAS_OPERATIONS_TOO_LARGE',
        message: `画布操作批次超过 ${MAX_CANVAS_OPERATIONS_BYTES / 1024 / 1024} MiB 大小限制。`,
        actualBytes,
        maxBytes: MAX_CANVAS_OPERATIONS_BYTES,
      },
    }
  }

  const source = record(value)
  if (!source || !hasOnlyKeys(source, ['expectedRevision', 'clientId', 'changeSummary', 'ops'])) {
    return { success: false, error: { code: 'CANVAS_OPERATIONS_INVALID', message: '画布操作批次格式无效。' } }
  }
  const expectedRevision = source.expectedRevision
  const clientId = cleanString(source.clientId, 120)
  const changeSummary = source.changeSummary == null ? null : cleanString(source.changeSummary, 160)
  if (
    typeof expectedRevision !== 'number' || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0
    || !clientId
    || (source.changeSummary != null && !changeSummary)
    || !Array.isArray(source.ops) || source.ops.length === 0 || source.ops.length > MAX_CANVAS_OPERATIONS
  ) {
    return { success: false, error: { code: 'CANVAS_OPERATIONS_INVALID', message: '画布操作批次格式无效。' } }
  }

  const ops: CanvasOperation[] = []
  const nodeActions = new Set<string>()
  const edgeAdds = new Set<string>()
  const edgeDeletes = new Set<string>()
  let metaSeen = false
  for (const value of source.ops) {
    const operation = parseOperation(value)
    if (!operation) {
      return { success: false, error: { code: 'CANVAS_OPERATIONS_INVALID', message: '画布操作批次包含无效操作。' } }
    }
    if (operation.type === 'node.upsert' || operation.type === 'node.delete') {
      const id = operation.type === 'node.upsert' ? operation.node.id : operation.id
      if (nodeActions.has(id)) {
        return { success: false, error: { code: 'CANVAS_OPERATIONS_INVALID', message: `节点 ${id} 在同一批次中被重复修改。` } }
      }
      nodeActions.add(id)
    } else if (operation.type === 'edge.add') {
      if (edgeAdds.has(operation.edge.id)) {
        return { success: false, error: { code: 'CANVAS_OPERATIONS_INVALID', message: `连线 ${operation.edge.id} 在同一批次中被重复添加。` } }
      }
      edgeAdds.add(operation.edge.id)
    } else if (operation.type === 'edge.delete') {
      if (edgeDeletes.has(operation.id)) {
        return { success: false, error: { code: 'CANVAS_OPERATIONS_INVALID', message: `连线 ${operation.id} 在同一批次中被重复删除。` } }
      }
      edgeDeletes.add(operation.id)
    } else {
      if (metaSeen) {
        return { success: false, error: { code: 'CANVAS_OPERATIONS_INVALID', message: '同一批次只能包含一个画布元数据操作。' } }
      }
      metaSeen = true
    }
    ops.push(operation)
  }

  return {
    success: true,
    data: {
      expectedRevision: expectedRevision as number,
      clientId,
      changeSummary,
      ops,
    },
  }
}
