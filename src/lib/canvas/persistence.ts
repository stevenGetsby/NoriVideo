import { Prisma } from '@prisma/client'
import { ApiError } from '@/lib/api-errors'
import {
  MAX_CANVAS_EDGES,
  MAX_CANVAS_NODES,
  type CanvasDocumentEdgeInput,
  type CanvasDocumentNodeInput,
  type CanvasDocumentSaveInput,
} from './document'
import { CANVAS_DOCUMENT_SCHEMA_VERSION } from './document-version'
import type { CanvasOperation, CanvasOperationsSaveInput } from './operations'
import {
  createStudioDocumentCopiesInTransaction,
  prepareStudioDocumentCopiesInTransaction,
  recordStudioDocumentsForSnapshotInTransaction,
  restoreStudioDocumentsInTransaction,
  withCanonicalCanvasStudioDocumentSource,
  type StudioDocumentArchiveEntry,
} from './studio-document-lifecycle'

export const SNAPSHOT_LIMIT = 20
export const SNAPSHOT_PROTECTED_LIMIT = 10
export const SNAPSHOT_MIN_INTERVAL_MS = 15 * 60_000
const SNAPSHOT_NODE_HISTORY_LIMIT = 3
const SNAPSHOT_INLINE_DATA_URL_MAX_BYTES = 8 * 1024

function isProtectedSnapshotSummary(changeSummary: string | null | undefined): boolean {
  const normalized = text(changeSummary)
  return normalized.startsWith('恢复到历史版本') || normalized.startsWith('手动保存')
}

function isViewportOnlyOperations(ops: CanvasOperation[]): boolean {
  return ops.length > 0 && ops.every((operation) => (
    operation.type === 'canvas.update_meta'
    && operation.title === undefined
    && operation.themeColor === undefined
  ))
}

function stripOversizedDataUrl(value: unknown): unknown {
  if (typeof value === 'string' && value.startsWith('data:') && value.length > SNAPSHOT_INLINE_DATA_URL_MAX_BYTES) {
    return undefined
  }
  return value
}

function compactSnapshotHistoryEntry(entry: unknown, hasNodePrompt: boolean): unknown {
  const item = record(entry)
  if (!item) return entry
  const compacted: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(item)) {
    // Reference summaries and multi-KB prompts duplicated across every past attempt
    // accounted for ~75% of canvas_snapshots size. When the node carries its own
    // active prompt, omit redundant history prompts/references from the archived copy.
    if (key === 'references') continue
    if (key === 'prompt' && hasNodePrompt) continue
    if (key === 'previewUrl' && stripOversizedDataUrl(value) === undefined) continue
    compacted[key] = value
  }
  return compacted
}

function compactSnapshotNodeData(rawData: unknown): unknown {
  const data = record(rawData)
  if (!data) return rawData
  const hasNodePrompt = typeof data.prompt === 'string' && data.prompt.trim().length > 0
  const output: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(data)) {
    if (key === 'history' && Array.isArray(value)) {
      output.history = value
        .slice(0, SNAPSHOT_NODE_HISTORY_LIMIT)
        .map((entry) => compactSnapshotHistoryEntry(entry, hasNodePrompt))
      continue
    }
    if (key === 'sourceMetadata') {
      const meta = record(value)
      if (meta && hasNodePrompt && Object.prototype.hasOwnProperty.call(meta, 'prompt')) {
        const rest = { ...meta }
        delete rest.prompt
        output.sourceMetadata = rest
        continue
      }
    }
    if ((key === 'previewUrl' || key === 'thumbnailDataUrl') && stripOversizedDataUrl(value) === undefined) {
      continue
    }
    output[key] = value
  }
  return output
}

/**
 * Compacts redundant per-node history and duplicated metadata when archiving a
 * snapshot to `canvas_snapshots` while preserving full restore fidelity (node
 * geometry, edges, active media, prompt, generation config, recent history).
 * Never mutates live `canvas_nodes` rows.
 */
export function compactCanvasSnapshotDocument(document: Prisma.InputJsonValue): Prisma.InputJsonValue {
  const documentRecord = record(document)
  if (!documentRecord) return document
  const nodes = Array.isArray(documentRecord.nodes)
    ? documentRecord.nodes.map((value) => {
        const node = record(value)
        if (!node || !Object.prototype.hasOwnProperty.call(node, 'data')) return value
        return {
          ...node,
          data: compactSnapshotNodeData(node.data),
        }
      })
    : documentRecord.nodes
  return {
    ...documentRecord,
    ...(nodes !== undefined ? { nodes } : {}),
  } as Prisma.InputJsonValue
}

function jsonValue(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return value === null ? Prisma.JsonNull : value as Prisma.InputJsonValue
}

type ExistingCanvasNodeState = {
  id: string
  status: string
  taskId: string | null
  runId: string | null
  mediaObjectId: string | null
  data: unknown
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function executionIds(node: ExistingCanvasNodeState): Set<string> {
  const data = record(node.data)
  const generation = record(data?.generation)
  const generationTask = record(data?.generationTask)
  return new Set([
    text(node.taskId),
    text(node.runId),
    text(generation?.assetId),
    text(generation?.taskId),
    text(generationTask?.taskId),
  ].filter(Boolean))
}

function isSameOrUnknownExecution(existing: ExistingCanvasNodeState, incoming: CanvasDocumentNodeInput): boolean {
  const previous = executionIds(existing)
  const next = executionIds(incoming)
  if (previous.size === 0 || next.size === 0) return true
  return Array.from(next).some((id) => previous.has(id))
}

function mergeTerminalHistory(incoming: unknown, existing: unknown): unknown {
  if (!Array.isArray(existing)) return incoming
  if (!Array.isArray(incoming)) return existing
  const output = [...existing]
  const known = new Set(existing.map((item) => text(record(item)?.id)).filter(Boolean))
  for (const item of incoming) {
    const id = text(record(item)?.id)
    if (!id || !known.has(id)) output.push(item)
  }
  return output
}

function mergeTerminalData(incomingValue: unknown, existingValue: unknown): Record<string, unknown> | null {
  const incoming = record(incomingValue)
  const existing = record(existingValue)
  if (!incoming && !existing) return null
  if (!existing) return incoming
  const output: Record<string, unknown> = { ...(incoming || {}) }
  const terminalKeys = [
    'contentUrl',
    'posterUrl',
    'imageUrl',
    'videoUrl',
    'audioUrl',
    'modelUrl',
    'materialId',
    'sourceMetadata',
    'progress',
    'errorMessage',
    'pollErrorMessage',
    'generationTask',
  ] as const
  for (const key of terminalKeys) {
    if (Object.prototype.hasOwnProperty.call(existing, key)) output[key] = existing[key]
  }
  if (Object.prototype.hasOwnProperty.call(existing, 'history')) {
    output.history = mergeTerminalHistory(incoming?.history, existing.history)
  }
  return output
}

function staleStoryboardPlanningWrite(
  existing: ExistingCanvasNodeState,
  incoming: CanvasDocumentNodeInput,
): boolean {
  const existingData = record(existing.data)
  const incomingData = record(incoming.data)
  const planningTaskId = text(existingData?.storyboardPlanningTaskId)
  const incomingPlanningTask = record(incomingData?.generationTask)
  if (
    !planningTaskId
    || incomingPlanningTask?.kind !== 'storyboard_plan'
    || text(incomingPlanningTask.taskId) !== planningTaskId
  ) return false
  const incomingGeneration = record(incomingData?.generation)
  return !text(incomingGeneration?.assetId)
    && (incoming.taskId === planningTaskId || text(incomingPlanningTask.taskId) === planningTaskId)
}

/**
 * A planning worker can replace the source node with shot 1 while a browser
 * still holds the pre-fan-out planning state. Keep the browser's position and
 * size edits, but never let that stale task binding erase the durable child
 * task, prompt, history or partial-failure state.
 */
function mergeCanvasStoryboardFanoutState(
  existing: ExistingCanvasNodeState,
  incoming: CanvasDocumentNodeInput,
): CanvasDocumentNodeInput | null {
  if (!staleStoryboardPlanningWrite(existing, incoming)) return null
  return {
    ...incoming,
    status: existing.status,
    taskId: existing.taskId,
    runId: existing.runId,
    mediaObjectId: existing.mediaObjectId,
    data: {
      ...(record(incoming.data) || {}),
      ...(record(existing.data) || {}),
    },
  }
}

function canvasNodeWriteData(node: CanvasDocumentNodeInput) {
  return {
    type: node.type,
    position: node.position as Prisma.InputJsonValue,
    size: jsonValue(node.size),
    data: jsonValue(node.data),
    status: node.status,
    taskId: node.taskId,
    runId: node.runId,
    mediaObjectId: node.mediaObjectId,
    parentNodeId: node.parentNodeId,
  }
}

async function lockCurrentCanvasNode(
  tx: Prisma.TransactionClient,
  canvasId: string,
  nodeId: string,
): Promise<ExistingCanvasNodeState | null> {
  const rows = await tx.$queryRaw<ExistingCanvasNodeState[]>(Prisma.sql`
    SELECT id, status, taskId, runId, mediaObjectId, data
    FROM canvas_nodes
    WHERE id = ${nodeId} AND canvasId = ${canvasId}
    LIMIT 1
    FOR UPDATE
  `)
  return rows[0] || null
}

/**
 * Task reconciliation can finish between a browser's last read and its next
 * autosave. Preserve that terminal truth when the stale browser writes the
 * same execution back as RUNNING; a genuinely new task id is still allowed.
 */
export function mergeCanvasTerminalNodeState(
  existing: ExistingCanvasNodeState | undefined,
  incoming: CanvasDocumentNodeInput,
): CanvasDocumentNodeInput {
  if (existing) {
    const storyboard = mergeCanvasStoryboardFanoutState(existing, incoming)
    if (storyboard) return storyboard
  }
  if (
    !existing
    || (existing.status !== 'SUCCEEDED' && existing.status !== 'FAILED')
    || incoming.status !== 'RUNNING'
    || !isSameOrUnknownExecution(existing, incoming)
  ) return incoming
  return {
    ...incoming,
    status: existing.status,
    taskId: existing.taskId || incoming.taskId,
    runId: existing.runId || incoming.runId,
    mediaObjectId: existing.mediaObjectId || incoming.mediaObjectId,
    data: mergeTerminalData(incoming.data, existing.data),
  }
}

export async function shouldRecordCanvasSnapshot(
  tx: Prisma.TransactionClient,
  canvasId: string,
  deletedNodeCount = 0,
  options: { viewportOnly?: boolean } = {},
): Promise<boolean> {
  if (deletedNodeCount >= 5) return true
  const latest = await tx.canvasSnapshot.findFirst({
    where: { canvasId },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  })
  if (!latest) return true
  // Pure viewport pan/zoom changes never alter nodes or edges; once a canvas
  // has a baseline snapshot, skip creating duplicate multi-MB viewport snapshots.
  if (options.viewportOnly) return false
  return latest.createdAt.getTime() <= Date.now() - SNAPSHOT_MIN_INTERVAL_MS
}

export async function recordCanvasSnapshotInTransaction(
  tx: Prisma.TransactionClient,
  {
    canvasId,
    revision,
    userId,
    clientId,
    changeSummary,
    document,
  }: {
    canvasId: string
    revision: number
    userId: string
    clientId: string | null
    changeSummary: string | null
    document: Prisma.InputJsonValue
  },
) {
  const compactedDocument = compactCanvasSnapshotDocument(document)
  const documentRecord = record(compactedDocument)
  const versionedDocument = {
    ...(documentRecord || {}),
    schema_version: CANVAS_DOCUMENT_SCHEMA_VERSION,
  } as Prisma.InputJsonValue
  const snapshot = await tx.canvasSnapshot.create({
    data: {
      canvasId,
      revision,
      userId,
      clientId,
      changeSummary,
      document: versionedDocument,
    },
    select: { id: true },
  })
  const snapshotDocument = record(versionedDocument)
  const snapshotNodes = Array.isArray(snapshotDocument?.nodes)
    ? snapshotDocument.nodes.flatMap((value) => {
        const node = record(value)
        return node && typeof node.id === 'string' && typeof node.type === 'string'
          ? [{ id: node.id, type: node.type, data: node.data }]
          : []
      })
    : []
  await recordStudioDocumentsForSnapshotInTransaction(tx, {
    snapshotId: snapshot.id,
    canvasId,
    nodes: snapshotNodes,
  })
  const existing = await tx.canvasSnapshot.findMany({
    where: { canvasId },
    orderBy: { revision: 'desc' },
    select: { id: true, changeSummary: true },
  })
  const staleIds: string[] = []
  let keptAuto = 0
  let keptProtected = 0
  for (const item of existing) {
    if (isProtectedSnapshotSummary(item.changeSummary)) {
      if (keptProtected < SNAPSHOT_PROTECTED_LIMIT) {
        keptProtected += 1
      } else {
        staleIds.push(item.id)
      }
    } else if (keptAuto < SNAPSHOT_LIMIT) {
      keptAuto += 1
    } else {
      staleIds.push(item.id)
    }
  }
  if (staleIds.length > 0) {
    await tx.canvasSnapshot.deleteMany({ where: { id: { in: staleIds } } })
  }
}

export async function replaceCanvasDocumentInTransaction(
  tx: Prisma.TransactionClient,
  {
    projectId,
    canvasId,
    userId,
    templateOwnerId = userId,
    input,
    studioDocumentRestore,
    forceSnapshot = false,
  }: {
    projectId: string
    canvasId: string
    userId: string
    templateOwnerId?: string
    input: CanvasDocumentSaveInput
    studioDocumentRestore?: StudioDocumentArchiveEntry[]
    forceSnapshot?: boolean
  },
) {
  const nextRevision = input.expectedRevision + 1
  const claimed = await tx.canvas.updateMany({
    where: { id: canvasId, projectId, revision: input.expectedRevision },
    data: {
      revision: { increment: 1 },
      viewport: input.viewport as Prisma.InputJsonValue,
    },
  })
  if (claimed.count !== 1) {
    throw new ApiError('CONFLICT', {
      message: '画布已被其他标签页更新。',
      expectedRevision: input.expectedRevision,
    })
  }

  const existingNodes = await tx.canvasNode.findMany({
    where: { canvasId },
    select: {
      id: true,
      type: true,
      position: true,
      size: true,
      status: true,
      taskId: true,
      runId: true,
      mediaObjectId: true,
      parentNodeId: true,
      data: true,
    },
  })
  const existingById = new Map(existingNodes.map((node) => [node.id, node]))
  const incomingPlanningTaskIds = new Set(input.nodes.flatMap((node) => {
    const generationTask = record(record(node.data)?.generationTask)
    return generationTask?.kind === 'storyboard_plan' && text(generationTask.taskId)
      ? [text(generationTask.taskId)]
      : []
  }))
  const incomingNodeIds = new Set(input.nodes.map((node) => node.id))
  const preservedFanoutNodes = existingNodes.filter((node) => (
    !incomingNodeIds.has(node.id)
    && incomingPlanningTaskIds.has(text(record(node.data)?.storyboardPlanningTaskId))
  ))
  const mergedNodes = [
    ...input.nodes.map((node) => mergeCanvasTerminalNodeState(existingById.get(node.id), node)),
    ...preservedFanoutNodes.map((node) => ({
      id: node.id,
      type: node.type,
      position: node.position as CanvasDocumentNodeInput['position'],
      size: node.size as CanvasDocumentNodeInput['size'],
      data: record(node.data),
      status: node.status,
      taskId: node.taskId,
      runId: node.runId,
      mediaObjectId: node.mediaObjectId,
      parentNodeId: node.parentNodeId,
    })),
  ]
  const studioDocumentCopies = studioDocumentRestore
    ? []
    : await prepareStudioDocumentCopiesInTransaction(tx, {
        projectId,
        templateOwnerId,
        nodes: mergedNodes.filter((node) => !existingById.has(node.id)),
      })
  const nodes = mergedNodes.map((node) => (
    withCanonicalCanvasStudioDocumentSource(node, projectId, canvasId)
  ))

  const existingEdges = preservedFanoutNodes.length > 0
    ? await tx.canvasEdge.findMany({
        where: { canvasId },
        select: {
          id: true,
          sourceNodeId: true,
          targetNodeId: true,
          sourceHandle: true,
          targetHandle: true,
          role: true,
        },
      })
    : []
  const finalNodeIds = new Set(nodes.map((node) => node.id))
  const preservedNodeIds = new Set(preservedFanoutNodes.map((node) => node.id))
  const edges = [...input.edges]
  const edgeIds = new Set(edges.map((edge) => edge.id))
  const edgeKeys = new Set(edges.map((edge) => [
    edge.sourceNodeId,
    edge.sourceHandle,
    edge.targetNodeId,
    edge.targetHandle,
  ].join('|')))
  for (const edge of existingEdges) {
    if (
      (!preservedNodeIds.has(edge.sourceNodeId) && !preservedNodeIds.has(edge.targetNodeId))
      || !finalNodeIds.has(edge.sourceNodeId)
      || !finalNodeIds.has(edge.targetNodeId)
      || edgeIds.has(edge.id)
    ) continue
    const key = [edge.sourceNodeId, edge.sourceHandle, edge.targetNodeId, edge.targetHandle].join('|')
    if (edgeKeys.has(key)) continue
    edges.push(edge)
    edgeIds.add(edge.id)
    edgeKeys.add(key)
  }
  if (nodes.length > MAX_CANVAS_NODES || edges.length > MAX_CANVAS_EDGES) {
    throw new ApiError('INVALID_PARAMS', {
      message: '合并后台故事版结果后，画布节点或连线数量超过安全限制。',
    })
  }

  await tx.canvasEdge.deleteMany({ where: { canvasId } })
  const nextNodeIds = new Set(nodes.map((node) => node.id))
  const removedNodeIds = existingNodes.map((node) => node.id).filter((id) => !nextNodeIds.has(id))
  if (removedNodeIds.length > 0) {
    await tx.canvasNode.deleteMany({ where: { canvasId, id: { in: removedNodeIds } } })
  }
  const createdNodes: CanvasDocumentNodeInput[] = []
  for (const [index, node] of nodes.entries()) {
    const existing = existingById.get(node.id)
    const data = canvasNodeWriteData(node)
    if (!existing) {
      createdNodes.push(node)
      continue
    }
    const protectTerminalRace = node.status === 'RUNNING'
      && existing.status !== 'SUCCEEDED'
      && existing.status !== 'FAILED'
    const updated = await tx.canvasNode.updateMany({
      where: {
        id: node.id,
        canvasId,
        ...(protectTerminalRace ? { status: { notIn: ['SUCCEEDED', 'FAILED'] } } : {}),
      },
      data,
    })
    if (updated.count === 0 && protectTerminalRace) {
      const current = await lockCurrentCanvasNode(tx, canvasId, node.id)
      if (!current) throw new ApiError('CONFLICT', { message: `节点 ${node.id} 已被删除，请重新加载画布。` })
      const recovered = mergeCanvasTerminalNodeState(current, node)
      const retried = await tx.canvasNode.updateMany({
        where: { id: node.id, canvasId, status: current.status },
        data: canvasNodeWriteData(recovered),
      })
      if (retried.count !== 1) throw new ApiError('CONFLICT', { message: `节点 ${node.id} 状态再次变化，请重新加载画布。` })
      nodes[index] = recovered
    }
  }
  if (createdNodes.length > 0) {
    await tx.canvasNode.createMany({
      data: createdNodes.map((node) => ({
        id: node.id,
        canvasId,
        type: node.type,
        position: node.position as Prisma.InputJsonValue,
        size: jsonValue(node.size),
        data: jsonValue(node.data),
        status: node.status,
        taskId: node.taskId,
        runId: node.runId,
        mediaObjectId: node.mediaObjectId,
        parentNodeId: node.parentNodeId,
      })),
    })
  }
  if (studioDocumentRestore) {
    await restoreStudioDocumentsInTransaction(tx, {
      projectId,
      canvasId,
      updatedBy: userId,
      nodes,
      documents: studioDocumentRestore,
    })
  } else {
    await createStudioDocumentCopiesInTransaction(tx, {
      projectId,
      canvasId,
      updatedBy: userId,
      copies: studioDocumentCopies,
    })
  }
  if (edges.length > 0) {
    await tx.canvasEdge.createMany({
      data: edges.map((edge) => ({
        id: edge.id,
        canvasId,
        sourceNodeId: edge.sourceNodeId,
        targetNodeId: edge.targetNodeId,
        sourceHandle: edge.sourceHandle,
        targetHandle: edge.targetHandle,
        role: edge.role,
      })),
    })
  }

  if (forceSnapshot || await shouldRecordCanvasSnapshot(tx, canvasId, removedNodeIds.length)) {
    await recordCanvasSnapshotInTransaction(tx, {
      canvasId,
      revision: nextRevision,
      userId,
      clientId: input.clientId,
      changeSummary: input.changeSummary,
      document: {
        viewport: input.viewport,
        nodes,
        edges,
      } as Prisma.InputJsonValue,
    })
  }

  const canvas = await tx.canvas.findUniqueOrThrow({
    where: { id: canvasId },
    select: {
      id: true,
      projectId: true,
      title: true,
      themeColor: true,
      viewport: true,
      revision: true,
      visibility: true,
      forkedFromId: true,
      createdAt: true,
      updatedAt: true,
    },
  })
  return {
    canvas,
    nodes: nodes.map((node) => ({ ...node, canvasId })),
    edges: edges.map((edge) => ({ ...edge, canvasId })),
  }
}

type PersistedCanvasNode = CanvasDocumentNodeInput & { canvasId: string }
type PersistedCanvasEdge = CanvasDocumentEdgeInput & { canvasId: string }

function invalidOperation(message: string): never {
  throw new ApiError('INVALID_PARAMS', {
    message,
    reason: 'CANVAS_OPERATIONS_INVALID',
  })
}

function edgeKey(edge: CanvasDocumentEdgeInput): string {
  return [edge.sourceNodeId, edge.sourceHandle, edge.targetNodeId, edge.targetHandle].join('|')
}

function withoutCanvasId<T extends { canvasId: string }>(value: T): Omit<T, 'canvasId'> {
  const { canvasId, ...output } = value
  void canvasId
  return output
}

function operationMeta(ops: CanvasOperation[]) {
  return ops.find((operation): operation is Extract<CanvasOperation, { type: 'canvas.update_meta' }> => (
    operation.type === 'canvas.update_meta'
  ))
}

const CANVAS_RESULT_SELECT = {
  id: true,
  projectId: true,
  title: true,
  themeColor: true,
  viewport: true,
  revision: true,
  visibility: true,
  forkedFromId: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.CanvasSelect

type CanvasOperationsArgs = {
  projectId: string
  canvasId: string
  userId: string
  templateOwnerId?: string
  input: CanvasOperationsSaveInput
}

type CanvasGeometryUpdate = Omit<Extract<CanvasOperation, { type: 'node.update_geometry' }>, 'type'>

type CanvasOperationsDeltaResult = {
  canvas: Prisma.CanvasGetPayload<{ select: typeof CANVAS_RESULT_SELECT }>
  delta: {
    nodes: PersistedCanvasNode[]
    edges: PersistedCanvasEdge[]
    deletedNodeIds: string[]
    deletedEdgeIds: string[]
    /** Moved or resized nodes; their data is intentionally not part of the delta. */
    geometry: CanvasGeometryUpdate[]
  }
}

type CanvasOperationsFullResult = CanvasOperationsDeltaResult & {
  nodes: PersistedCanvasNode[]
  edges: PersistedCanvasEdge[]
}

/**
 * With `deltaOnly`, a batch that only carries canvas metadata (a pan or zoom) never
 * loads the node and edge rows, because the caller only needs the revision and the
 * entities that were written. The graph-wide snapshot still runs when one is due.
 */
export async function applyCanvasOperationsInTransaction(
  tx: Prisma.TransactionClient,
  args: CanvasOperationsArgs & { deltaOnly: true },
): Promise<CanvasOperationsDeltaResult>
export async function applyCanvasOperationsInTransaction(
  tx: Prisma.TransactionClient,
  args: CanvasOperationsArgs & { deltaOnly?: false },
): Promise<CanvasOperationsFullResult>
export async function applyCanvasOperationsInTransaction(
  tx: Prisma.TransactionClient,
  {
    projectId,
    canvasId,
    userId,
    templateOwnerId = userId,
    input,
    deltaOnly = false,
  }: CanvasOperationsArgs & { deltaOnly?: boolean },
): Promise<CanvasOperationsFullResult | CanvasOperationsDeltaResult> {
  const nextRevision = input.expectedRevision + 1
  const meta = operationMeta(input.ops)
  const claimed = await tx.canvas.updateMany({
    where: { id: canvasId, projectId, revision: input.expectedRevision },
    data: {
      revision: { increment: 1 },
      ...(meta?.title === undefined ? {} : { title: meta.title }),
      ...(meta?.themeColor === undefined ? {} : { themeColor: meta.themeColor }),
      ...(meta?.viewport === undefined ? {} : { viewport: meta.viewport as Prisma.InputJsonValue }),
    },
  })
  if (claimed.count !== 1) {
    const actual = await tx.canvas.findFirst({
      where: { id: canvasId, projectId },
      select: { revision: true },
    })
    throw new ApiError('CONFLICT', {
      message: '画布已被其他标签页更新。',
      expectedRevision: input.expectedRevision,
      actualRevision: actual?.revision,
    })
  }

  const viewportOnly = isViewportOnlyOperations(input.ops)
  const hasStructuralDeletesOrEdges = input.ops.some((operation) => (
    operation.type === 'node.delete' || operation.type === 'edge.add' || operation.type === 'edge.delete'
  ))
  if (
    deltaOnly
    && !hasStructuralDeletesOrEdges
    && !await shouldRecordCanvasSnapshot(tx, canvasId, 0, { viewportOnly })
  ) {
    const upsertOps = input.ops.filter((operation): operation is Extract<CanvasOperation, { type: 'node.upsert' }> => (
      operation.type === 'node.upsert'
    ))
    const geometryOps = input.ops.filter((operation): operation is Extract<CanvasOperation, { type: 'node.update_geometry' }> => (
      operation.type === 'node.update_geometry'
    ))
    // Pure metadata and geometry batches (pan/zoom/drag/resize) never need to read
    // any node data or edges from the database.
    if (upsertOps.length === 0) {
      const geometryUpdates: CanvasGeometryUpdate[] = []
      for (const operation of geometryOps) {
        const updated = await tx.canvasNode.updateMany({
          where: { id: operation.id, canvasId },
          data: {
            ...(operation.position ? { position: operation.position as Prisma.InputJsonValue } : {}),
            ...(operation.size ? { size: operation.size as Prisma.InputJsonValue } : {}),
          },
        })
        if (updated.count !== 1) invalidOperation(`要移动的节点 ${operation.id} 不存在。`)
        geometryUpdates.push({
          id: operation.id,
          ...(operation.position ? { position: operation.position } : {}),
          ...(operation.size ? { size: operation.size } : {}),
        })
      }
      return {
        canvas: await tx.canvas.findUniqueOrThrow({ where: { id: canvasId }, select: CANVAS_RESULT_SELECT }),
        delta: { nodes: [], edges: [], deletedNodeIds: [], deletedEdgeIds: [], geometry: geometryUpdates },
      }
    }

    // Narrow node.upsert (+ optional meta/geometry) batches to only the touched node IDs
    // instead of loading every node's JSON body and every edge in the canvas.
    const touchedNodeIds = Array.from(new Set([
      ...upsertOps.map((operation) => operation.node.id),
      ...geometryOps.map((operation) => operation.id),
    ]))
    const storedNodes = await tx.canvasNode.findMany({
      where: { canvasId, id: { in: touchedNodeIds } },
      select: {
        id: true,
        canvasId: true,
        type: true,
        position: true,
        size: true,
        data: true,
        status: true,
        taskId: true,
        runId: true,
        mediaObjectId: true,
        parentNodeId: true,
      },
    })
    const nodes = new Map(storedNodes.map((node) => [node.id, node as PersistedCanvasNode]))
    const initialNodeIds = new Set(nodes.keys())
    const newNodeIds = new Set(
      upsertOps.map((operation) => operation.node.id).filter((id) => !initialNodeIds.has(id)),
    )
    if (newNodeIds.size > 0 && typeof tx.canvasNode.count === 'function') {
      const existingCount = await tx.canvasNode.count({ where: { canvasId } })
      if (existingCount + newNodeIds.size > MAX_CANVAS_NODES) {
        invalidOperation('画布操作后的节点或连线数量超过安全限制。')
      }
    }
    const studioDocumentCopies = await prepareStudioDocumentCopiesInTransaction(tx, {
      projectId,
      templateOwnerId,
      nodes: upsertOps
        .filter((operation) => !initialNodeIds.has(operation.node.id))
        .map((operation) => operation.node),
    })
    const upsertedNodes: CanvasDocumentNodeInput[] = []
    const geometryUpdates: CanvasGeometryUpdate[] = []
    for (const operation of upsertOps) {
      const existing = nodes.get(operation.node.id)
      const node = withCanonicalCanvasStudioDocumentSource(
        mergeCanvasTerminalNodeState(existing, operation.node),
        projectId,
        canvasId,
      )
      nodes.set(node.id, { ...node, canvasId })
      upsertedNodes.push(node)
    }
    for (const operation of geometryOps) {
      const existing = nodes.get(operation.id)
      if (!existing) invalidOperation(`要移动的节点 ${operation.id} 不存在。`)
      nodes.set(operation.id, {
        ...existing,
        ...(operation.position ? { position: operation.position } : {}),
        ...(operation.size ? { size: operation.size } : {}),
      })
      geometryUpdates.push({
        id: operation.id,
        ...(operation.position ? { position: operation.position } : {}),
        ...(operation.size ? { size: operation.size } : {}),
      })
    }
    const persistedIds = new Set(initialNodeIds)
    for (const node of upsertedNodes) {
      const data = canvasNodeWriteData(node)
      if (persistedIds.has(node.id)) {
        const existing = storedNodes.find((item) => item.id === node.id)
        const protectTerminalRace = node.status === 'RUNNING'
          && existing?.status !== 'SUCCEEDED'
          && existing?.status !== 'FAILED'
        const updated = await tx.canvasNode.updateMany({
          where: {
            id: node.id,
            canvasId,
            ...(protectTerminalRace ? { status: { notIn: ['SUCCEEDED', 'FAILED'] } } : {}),
          },
          data,
        })
        if (updated.count !== 1 && protectTerminalRace) {
          const current = await lockCurrentCanvasNode(tx, canvasId, node.id)
          if (!current) invalidOperation(`节点 ${node.id} 已不属于当前画布。`)
          const recovered = mergeCanvasTerminalNodeState(current, node)
          const retried = await tx.canvasNode.updateMany({
            where: { id: node.id, canvasId, status: current.status },
            data: canvasNodeWriteData(recovered),
          })
          if (retried.count !== 1) {
            throw new ApiError('CONFLICT', { message: `节点 ${node.id} 状态再次变化，请重新加载画布。` })
          }
          nodes.set(node.id, { ...recovered, canvasId })
          const pendingIndex = upsertedNodes.findIndex((item) => item.id === node.id)
          if (pendingIndex >= 0) upsertedNodes[pendingIndex] = recovered
        } else if (updated.count !== 1) {
          invalidOperation(`节点 ${node.id} 已不属于当前画布。`)
        }
      } else {
        await tx.canvasNode.create({ data: { id: node.id, canvasId, ...data } })
        persistedIds.add(node.id)
      }
    }
    for (const update of geometryUpdates) {
      const updated = await tx.canvasNode.updateMany({
        where: { id: update.id, canvasId },
        data: {
          ...(update.position ? { position: update.position as Prisma.InputJsonValue } : {}),
          ...(update.size ? { size: update.size as Prisma.InputJsonValue } : {}),
        },
      })
      if (updated.count !== 1) invalidOperation(`节点 ${update.id} 已不属于当前画布。`)
    }
    await createStudioDocumentCopiesInTransaction(tx, {
      projectId,
      canvasId,
      updatedBy: userId,
      copies: studioDocumentCopies,
    })
    const canvas = await tx.canvas.findUniqueOrThrow({ where: { id: canvasId }, select: CANVAS_RESULT_SELECT })
    return {
      canvas,
      delta: {
        nodes: upsertedNodes.map((node) => ({ ...node, canvasId })),
        edges: [],
        deletedNodeIds: [],
        deletedEdgeIds: [],
        geometry: geometryUpdates,
      },
    }
  }

  const [storedNodes, storedEdges] = await Promise.all([
    tx.canvasNode.findMany({
      where: { canvasId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        canvasId: true,
        type: true,
        position: true,
        size: true,
        data: true,
        status: true,
        taskId: true,
        runId: true,
        mediaObjectId: true,
        parentNodeId: true,
      },
    }),
    tx.canvasEdge.findMany({
      where: { canvasId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        canvasId: true,
        sourceNodeId: true,
        targetNodeId: true,
        sourceHandle: true,
        targetHandle: true,
        role: true,
      },
    }),
  ])
  const nodes = new Map(storedNodes.map((node) => [node.id, node as PersistedCanvasNode]))
  const edges = new Map(storedEdges.map((edge) => [edge.id, edge as PersistedCanvasEdge]))
  const initialNodeIds = new Set(nodes.keys())
  const studioDocumentCopies = await prepareStudioDocumentCopiesInTransaction(tx, {
    projectId,
    templateOwnerId,
    nodes: input.ops.flatMap((operation) => (
      operation.type === 'node.upsert' && !initialNodeIds.has(operation.node.id)
        ? [operation.node]
        : []
    )),
  })
  const deletedEdgeIds = new Set<string>()
  const deletedNodeIds = new Set<string>()
  const upsertedNodes: CanvasDocumentNodeInput[] = []
  const geometryUpdates: CanvasGeometryUpdate[] = []
  const addedEdges: CanvasDocumentEdgeInput[] = []

  for (const operation of input.ops) {
    if (operation.type !== 'edge.delete') continue
    if (!edges.delete(operation.id)) invalidOperation(`要删除的连线 ${operation.id} 不存在。`)
    deletedEdgeIds.add(operation.id)
  }
  for (const operation of input.ops) {
    if (operation.type !== 'node.delete') continue
    if (!nodes.delete(operation.id)) invalidOperation(`要删除的节点 ${operation.id} 不存在。`)
    deletedNodeIds.add(operation.id)
    for (const [edgeId, edge] of edges) {
      if (edge.sourceNodeId === operation.id || edge.targetNodeId === operation.id) {
        edges.delete(edgeId)
        deletedEdgeIds.add(edgeId)
      }
    }
  }
  for (const operation of input.ops) {
    if (operation.type !== 'node.upsert') continue
    const existing = nodes.get(operation.node.id)
    const node = withCanonicalCanvasStudioDocumentSource(
      mergeCanvasTerminalNodeState(existing, operation.node),
      projectId,
      canvasId,
    )
    nodes.set(node.id, { ...node, canvasId })
    upsertedNodes.push(node)
  }
  for (const operation of input.ops) {
    if (operation.type !== 'node.update_geometry') continue
    const existing = nodes.get(operation.id)
    if (!existing) invalidOperation(`要移动的节点 ${operation.id} 不存在。`)
    nodes.set(operation.id, {
      ...existing,
      ...(operation.position ? { position: operation.position } : {}),
      ...(operation.size ? { size: operation.size } : {}),
    })
    geometryUpdates.push({
      id: operation.id,
      ...(operation.position ? { position: operation.position } : {}),
      ...(operation.size ? { size: operation.size } : {}),
    })
  }
  for (const operation of input.ops) {
    if (operation.type !== 'edge.add') continue
    const edge = operation.edge
    if (edges.has(edge.id)) invalidOperation(`要添加的连线 ${edge.id} 已存在。`)
    if (!nodes.has(edge.sourceNodeId) || !nodes.has(edge.targetNodeId)) {
      invalidOperation(`连线 ${edge.id} 引用了不存在的节点。`)
    }
    edges.set(edge.id, { ...edge, canvasId })
    addedEdges.push(edge)
  }

  if (nodes.size > MAX_CANVAS_NODES || edges.size > MAX_CANVAS_EDGES) {
    invalidOperation('画布操作后的节点或连线数量超过安全限制。')
  }
  const uniqueEdges = new Set<string>()
  const addedEdgeIds = new Set(addedEdges.map((edge) => edge.id))
  for (const edge of Array.from(edges.values())) {
    if (!nodes.has(edge.sourceNodeId) || !nodes.has(edge.targetNodeId)) {
      invalidOperation(`连线 ${edge.id} 引用了不存在的节点。`)
    }
    const key = edgeKey(edge)
    if (uniqueEdges.has(key)) {
      if (addedEdgeIds.has(edge.id)) invalidOperation(`连线 ${edge.id} 与现有连线重复。`)
      // 历史遗留的重复连线不应让整批保存（含删除）永远失败：随本次保存清理掉。
      edges.delete(edge.id)
      deletedEdgeIds.add(edge.id)
      continue
    }
    uniqueEdges.add(key)
  }

  if (deletedEdgeIds.size > 0) {
    await tx.canvasEdge.deleteMany({ where: { canvasId, id: { in: Array.from(deletedEdgeIds) } } })
  }
  if (deletedNodeIds.size > 0) {
    await tx.canvasNode.deleteMany({ where: { canvasId, id: { in: Array.from(deletedNodeIds) } } })
  }
  for (const node of upsertedNodes) {
    const data = canvasNodeWriteData(node)
    if (initialNodeIds.has(node.id)) {
      const existing = storedNodes.find((item) => item.id === node.id)
      const protectTerminalRace = node.status === 'RUNNING'
        && existing?.status !== 'SUCCEEDED'
        && existing?.status !== 'FAILED'
      const updated = await tx.canvasNode.updateMany({
        where: {
          id: node.id,
          canvasId,
          ...(protectTerminalRace ? { status: { notIn: ['SUCCEEDED', 'FAILED'] } } : {}),
        },
        data,
      })
      if (updated.count !== 1 && protectTerminalRace) {
        const current = await lockCurrentCanvasNode(tx, canvasId, node.id)
        if (!current) invalidOperation(`节点 ${node.id} 已不属于当前画布。`)
        const recovered = mergeCanvasTerminalNodeState(current, node)
        const retried = await tx.canvasNode.updateMany({
          where: { id: node.id, canvasId, status: current.status },
          data: canvasNodeWriteData(recovered),
        })
        if (retried.count !== 1) {
          throw new ApiError('CONFLICT', { message: `节点 ${node.id} 状态再次变化，请重新加载画布。` })
        }
        nodes.set(node.id, { ...recovered, canvasId })
        const pendingIndex = upsertedNodes.findIndex((item) => item.id === node.id)
        if (pendingIndex >= 0) upsertedNodes[pendingIndex] = recovered
      } else if (updated.count !== 1) {
        invalidOperation(`节点 ${node.id} 已不属于当前画布。`)
      }
    } else {
      await tx.canvasNode.create({ data: { id: node.id, canvasId, ...data } })
    }
  }
  for (const update of geometryUpdates) {
    const updated = await tx.canvasNode.updateMany({
      where: { id: update.id, canvasId },
      data: {
        ...(update.position ? { position: update.position as Prisma.InputJsonValue } : {}),
        ...(update.size ? { size: update.size as Prisma.InputJsonValue } : {}),
      },
    })
    if (updated.count !== 1) invalidOperation(`节点 ${update.id} 已不属于当前画布。`)
  }
  await createStudioDocumentCopiesInTransaction(tx, {
    projectId,
    canvasId,
    updatedBy: userId,
    copies: studioDocumentCopies,
  })
  if (addedEdges.length > 0) {
    await tx.canvasEdge.createMany({
      data: addedEdges.map((edge) => ({ ...edge, canvasId })),
    })
  }

  const canvas = await tx.canvas.findUniqueOrThrow({ where: { id: canvasId }, select: CANVAS_RESULT_SELECT })
  const finalNodes = Array.from(nodes.values())
  const finalEdges = Array.from(edges.values())
  if (await shouldRecordCanvasSnapshot(tx, canvasId, deletedNodeIds.size, { viewportOnly })) {
    await recordCanvasSnapshotInTransaction(tx, {
      canvasId,
      revision: nextRevision,
      userId,
      clientId: input.clientId,
      changeSummary: input.changeSummary,
      document: {
        viewport: canvas.viewport || { x: 0, y: 0, zoom: 1 },
        nodes: finalNodes.map(withoutCanvasId),
        edges: finalEdges.map(withoutCanvasId),
      } as Prisma.InputJsonValue,
    })
  }

  return {
    canvas,
    nodes: finalNodes,
    edges: finalEdges,
    delta: {
      nodes: upsertedNodes.map((node) => ({ ...node, canvasId })),
      edges: addedEdges.map((edge) => ({ ...edge, canvasId })),
      deletedNodeIds: Array.from(deletedNodeIds),
      deletedEdgeIds: Array.from(deletedEdgeIds),
      geometry: geometryUpdates,
    },
  }
}
