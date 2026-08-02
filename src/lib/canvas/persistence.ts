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

const SNAPSHOT_LIMIT = 40

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
  const documentRecord = record(document)
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
  const stale = await tx.canvasSnapshot.findMany({
    where: { canvasId },
    orderBy: { revision: 'desc' },
    skip: SNAPSHOT_LIMIT,
    select: { id: true },
  })
  if (stale.length > 0) {
    await tx.canvasSnapshot.deleteMany({ where: { id: { in: stale.map((item) => item.id) } } })
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
  }: {
    projectId: string
    canvasId: string
    userId: string
    templateOwnerId?: string
    input: CanvasDocumentSaveInput
    studioDocumentRestore?: StudioDocumentArchiveEntry[]
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

export async function applyCanvasOperationsInTransaction(
  tx: Prisma.TransactionClient,
  {
    projectId,
    canvasId,
    userId,
    templateOwnerId = userId,
    input,
  }: {
    projectId: string
    canvasId: string
    userId: string
    templateOwnerId?: string
    input: CanvasOperationsSaveInput
  },
) {
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
  for (const edge of edges.values()) {
    if (!nodes.has(edge.sourceNodeId) || !nodes.has(edge.targetNodeId)) {
      invalidOperation(`连线 ${edge.id} 引用了不存在的节点。`)
    }
    const key = edgeKey(edge)
    if (uniqueEdges.has(key)) invalidOperation(`连线 ${edge.id} 与现有连线重复。`)
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
  const finalNodes = Array.from(nodes.values())
  const finalEdges = Array.from(edges.values())
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

  return { canvas, nodes: finalNodes, edges: finalEdges }
}
