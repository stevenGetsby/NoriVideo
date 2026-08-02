import { CANVAS_EDGE_ROLE_VALUES, CANVAS_NODE_STATUS_VALUES, isAllowedNodeType } from './access'
import {
  CANVAS_DOCUMENT_SCHEMA_VERSION,
  isCompatibleCanvasDocumentSchemaVersion,
} from './document-version'

export const MAX_CANVAS_NODES = 1_000
export const MAX_CANVAS_EDGES = 4_000
const MAX_COORDINATE = 10_000_000
const MAX_NODE_DATA_BYTES = 512 * 1024
export const MAX_CANVAS_DOCUMENT_BYTES = 16 * 1024 * 1024

export type CanvasDocumentNodeInput = {
  id: string
  type: string
  position: { x: number; y: number }
  size: { width: number; height: number } | null
  data: Record<string, unknown> | null
  status: string
  taskId: string | null
  runId: string | null
  mediaObjectId: string | null
  parentNodeId: string | null
}

export type CanvasDocumentEdgeInput = {
  id: string
  sourceNodeId: string
  targetNodeId: string
  sourceHandle: string | null
  targetHandle: string | null
  role: string
}

export type CanvasDocumentSaveInput = {
  schema_version: typeof CANVAS_DOCUMENT_SCHEMA_VERSION
  expectedRevision: number
  clientId: string
  changeSummary: string | null
  viewport: { x: number; y: number; zoom: number }
  nodes: CanvasDocumentNodeInput[]
  edges: CanvasDocumentEdgeInput[]
}

export type CanvasDocumentValidationError = {
  code: 'CANVAS_DOCUMENT_INVALID' | 'CANVAS_DOCUMENT_TOO_LARGE'
  message: string
  actualBytes?: number
  maxBytes?: number
}

export type CanvasDocumentValidationResult =
  | { success: true; data: CanvasDocumentSaveInput }
  | { success: false; error: CanvasDocumentValidationError }

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function cleanString(value: unknown, max = 191): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed && trimmed.length <= max ? trimmed : null
}

function nullableString(value: unknown, max = 191): string | null | undefined {
  if (value == null) return null
  return cleanString(value, max) ?? undefined
}

function finite(value: unknown, min: number, max: number): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
    ? value
    : null
}

export function parseCanvasPosition(value: unknown): { x: number; y: number } | null {
  const source = record(value)
  if (!source) return null
  const x = finite(source.x, -MAX_COORDINATE, MAX_COORDINATE)
  const y = finite(source.y, -MAX_COORDINATE, MAX_COORDINATE)
  return x === null || y === null ? null : { x, y }
}

export function parseCanvasSize(value: unknown): { width: number; height: number } | null | undefined {
  if (value == null) return null
  const source = record(value)
  if (!source) return undefined
  const width = finite(source.width, 80, 5_000)
  const height = finite(source.height, 60, 5_000)
  return width === null || height === null ? undefined : { width, height }
}

export function parseCanvasNodeData(value: unknown): Record<string, unknown> | null | undefined {
  if (value == null) return null
  const source = record(value)
  if (!source) return undefined
  try {
    if (Buffer.byteLength(JSON.stringify(source), 'utf8') > MAX_NODE_DATA_BYTES) return undefined
  } catch {
    return undefined
  }
  return source
}

export function parseCanvasDocumentNodeInput(value: unknown): CanvasDocumentNodeInput | null {
  const source = record(value)
  if (!source) return null
  const id = cleanString(source.id)
  const type = cleanString(source.type, 64)
  const position = parseCanvasPosition(source.position)
  const size = parseCanvasSize(source.size)
  const data = parseCanvasNodeData(source.data)
  const rawStatus = cleanString(source.status, 32) || 'IDLE'
  const taskId = nullableString(source.taskId)
  const runId = nullableString(source.runId)
  const mediaObjectId = nullableString(source.mediaObjectId)
  const parentNodeId = nullableString(source.parentNodeId)
  if (!id || !type || !isAllowedNodeType(type) || !position || size === undefined || data === undefined) return null
  if (!(CANVAS_NODE_STATUS_VALUES as readonly string[]).includes(rawStatus)) return null
  if ([taskId, runId, mediaObjectId, parentNodeId].some((item) => item === undefined)) return null
  return {
    id,
    type,
    position,
    size,
    data,
    status: rawStatus,
    taskId: taskId ?? null,
    runId: runId ?? null,
    mediaObjectId: mediaObjectId ?? null,
    parentNodeId: parentNodeId ?? null,
  }
}

export function parseCanvasDocumentEdgeInput(value: unknown): CanvasDocumentEdgeInput | null {
  const source = record(value)
  if (!source) return null
  const id = cleanString(source.id)
  const sourceNodeId = cleanString(source.sourceNodeId)
  const targetNodeId = cleanString(source.targetNodeId)
  const sourceHandle = nullableString(source.sourceHandle, 80)
  const targetHandle = nullableString(source.targetHandle, 80)
  const role = cleanString(source.role, 64) || 'INPUT_DEFAULT'
  if (!id || !sourceNodeId || !targetNodeId || sourceNodeId === targetNodeId) return null
  if (sourceHandle === undefined || targetHandle === undefined) return null
  if (!(CANVAS_EDGE_ROLE_VALUES as readonly string[]).includes(role)) return null
  return { id, sourceNodeId, targetNodeId, sourceHandle: sourceHandle ?? null, targetHandle: targetHandle ?? null, role }
}

function parseCanvasDocumentStructure(value: unknown): CanvasDocumentSaveInput | null {
  const source = record(value)
  if (!source) return null
  if (!isCompatibleCanvasDocumentSchemaVersion(source.schema_version)) return null
  const expectedRevision = finite(source.expectedRevision, 0, Number.MAX_SAFE_INTEGER)
  const clientId = cleanString(source.clientId, 120)
  const changeSummary = source.changeSummary == null ? null : cleanString(source.changeSummary, 160)
  const viewportSource = record(source.viewport)
  const x = viewportSource ? finite(viewportSource.x, -MAX_COORDINATE, MAX_COORDINATE) : null
  const y = viewportSource ? finite(viewportSource.y, -MAX_COORDINATE, MAX_COORDINATE) : null
  const zoom = viewportSource ? finite(viewportSource.zoom, 0.05, 8) : null
  if (expectedRevision === null || !Number.isInteger(expectedRevision) || !clientId || !viewportSource || x === null || y === null || zoom === null) return null
  if (source.changeSummary != null && !changeSummary) return null
  if (!Array.isArray(source.nodes) || source.nodes.length > MAX_CANVAS_NODES) return null
  if (!Array.isArray(source.edges) || source.edges.length > MAX_CANVAS_EDGES) return null

  const nodes: CanvasDocumentNodeInput[] = []
  const nodeIds = new Set<string>()
  for (const item of source.nodes) {
    const node = parseCanvasDocumentNodeInput(item)
    if (!node || nodeIds.has(node.id)) return null
    nodeIds.add(node.id)
    nodes.push(node)
  }

  const edges: CanvasDocumentEdgeInput[] = []
  const edgeIds = new Set<string>()
  const edgeKeys = new Set<string>()
  for (const item of source.edges) {
    const edge = parseCanvasDocumentEdgeInput(item)
    if (!edge || edgeIds.has(edge.id)) return null
    if (!nodeIds.has(edge.sourceNodeId) || !nodeIds.has(edge.targetNodeId)) return null
    const edgeKey = [edge.sourceNodeId, edge.sourceHandle, edge.targetNodeId, edge.targetHandle].join('|')
    if (edgeKeys.has(edgeKey)) return null
    edgeIds.add(edge.id)
    edgeKeys.add(edgeKey)
    edges.push(edge)
  }

  return {
    schema_version: CANVAS_DOCUMENT_SCHEMA_VERSION,
    expectedRevision,
    clientId,
    changeSummary,
    viewport: { x, y, zoom },
    nodes,
    edges,
  }
}

function serializedByteLength(value: unknown): number | null {
  try {
    const serialized = JSON.stringify(value)
    return typeof serialized === 'string' ? Buffer.byteLength(serialized, 'utf8') : null
  } catch {
    return null
  }
}

export function validateCanvasDocumentSaveInput(value: unknown): CanvasDocumentValidationResult {
  const actualBytes = serializedByteLength(value)
  if (actualBytes === null) {
    return {
      success: false,
      error: {
        code: 'CANVAS_DOCUMENT_INVALID',
        message: '画布文档无法序列化。',
      },
    }
  }
  if (actualBytes > MAX_CANVAS_DOCUMENT_BYTES) {
    return {
      success: false,
      error: {
        code: 'CANVAS_DOCUMENT_TOO_LARGE',
        message: `画布文档超过 ${MAX_CANVAS_DOCUMENT_BYTES / 1024 / 1024} MiB 总大小限制，请删除不再使用的节点历史或媒体内联数据后重试。`,
        actualBytes,
        maxBytes: MAX_CANVAS_DOCUMENT_BYTES,
      },
    }
  }

  const data = parseCanvasDocumentStructure(value)
  if (!data) {
    return {
      success: false,
      error: {
        code: 'CANVAS_DOCUMENT_INVALID',
        message: '画布文档格式无效。',
      },
    }
  }
  return { success: true, data }
}

export function parseCanvasDocumentSaveInput(value: unknown): CanvasDocumentSaveInput | null {
  const result = validateCanvasDocumentSaveInput(value)
  return result.success ? result.data : null
}
