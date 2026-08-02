import { createHash } from 'node:crypto'
import { ApiError } from '@/lib/api-errors'
import { applyCanvasOperationsInTransaction } from '@/lib/canvas/persistence'
import type { CanvasOperation } from '@/lib/canvas/operations'
import { prisma } from '@/lib/prisma'

const MULTI_IMAGE_NODE_GAP = 46
const DEFAULT_IMAGE_NODE_WIDTH = 300

type StoredCanvasNode = {
  id: string
  type: string
  position: unknown
  size: unknown
  data: unknown
  parentNodeId: string | null
}

type StoredCanvasEdge = {
  id: string
  sourceNodeId: string
  sourceHandle: string | null
  targetHandle: string | null
  role: string
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function finiteNumber(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function stableUuid(namespace: string, values: Record<string, unknown>) {
  const hex = createHash('sha256')
    .update(namespace)
    .update(JSON.stringify(values))
    .digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

export function stableCanvasToolboxOutputNodeId(input: {
  userId: string
  projectId: string
  canvasId: string
  sourceNodeId: string
  idempotencyKey: string
  index: number
}) {
  if (input.index === 0) return input.sourceNodeId
  return stableUuid('canvas-toolbox-output-node:v1', input)
}

export function stableCanvasToolboxOutputEdgeId(input: {
  userId: string
  projectId: string
  canvasId: string
  sourceNodeId: string
  sourceEdgeId: string
  outputNodeId: string
  idempotencyKey: string
}) {
  return stableUuid('canvas-toolbox-output-edge:v1', input)
}

function cloneOutputNodeData(sourceValue: unknown, input: {
  sourceNodeId: string
  title: string
  prompt: string
  index: number
}) {
  const source = record(sourceValue)
  const generation = { ...record(source.generation) }
  delete generation.assetId
  delete generation.taskId
  return {
    ...source,
    title: `${input.title} ${input.index + 1}`,
    mediaType: 'image',
    origin: 'generate',
    prompt: input.prompt,
    contentUrl: null,
    imageUrl: null,
    videoUrl: null,
    audioUrl: null,
    modelUrl: null,
    posterUrl: null,
    materialId: null,
    sourceMetadata: null,
    generation,
    history: [],
    progress: 1,
    errorMessage: null,
    pollErrorMessage: null,
    toolboxOutput: {
      sourceNodeId: input.sourceNodeId,
      index: input.index,
    },
  }
}

function outputNodeOperation(source: StoredCanvasNode, input: {
  nodeId: string
  title: string
  prompt: string
  index: number
}) {
  const position = record(source.position)
  const size = record(source.size)
  const width = Math.max(80, finiteNumber(size.width, DEFAULT_IMAGE_NODE_WIDTH))
  return {
    type: 'node.upsert',
    node: {
      id: input.nodeId,
      type: 'image',
      position: {
        x: finiteNumber(position.x, 0) + input.index * (width + MULTI_IMAGE_NODE_GAP),
        y: finiteNumber(position.y, 0),
      },
      size: Object.keys(size).length > 0
        ? { width, height: Math.max(60, finiteNumber(size.height, 200)) }
        : null,
      data: cloneOutputNodeData(source.data, {
        sourceNodeId: source.id,
        title: input.title,
        prompt: input.prompt,
        index: input.index,
      }),
      status: 'IDLE',
      taskId: null,
      runId: null,
      mediaObjectId: null,
      parentNodeId: source.parentNodeId,
    },
  } satisfies CanvasOperation
}

function outputEdgeOperation(edge: StoredCanvasEdge, input: {
  userId: string
  projectId: string
  canvasId: string
  sourceNodeId: string
  outputNodeId: string
  idempotencyKey: string
}) {
  return {
    type: 'edge.add',
    edge: {
      id: stableCanvasToolboxOutputEdgeId({
        ...input,
        sourceEdgeId: edge.id,
      }),
      sourceNodeId: edge.sourceNodeId,
      targetNodeId: input.outputNodeId,
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
      role: edge.role,
    },
  } satisfies CanvasOperation
}

async function findPreparedOutputNodeIds(canvasId: string, outputNodeIds: string[]) {
  if (outputNodeIds.length <= 1) return outputNodeIds
  const rows = await prisma.canvasNode.findMany({
    where: {
      canvasId,
      id: { in: outputNodeIds.slice(1) },
      type: 'image',
    },
    select: { id: true },
  })
  const found = new Set(rows.map((row) => row.id))
  return outputNodeIds.filter((nodeId, index) => index === 0 || found.has(nodeId))
}

/**
 * Persist ordinary multi-image output nodes before any provider task exists.
 * The operation uses the canvas revision/snapshot transaction, so a refresh can
 * recover every output and a stale browser autosave cannot silently delete it.
 */
export async function prepareCanvasToolboxImageOutputs(input: {
  userId: string
  actorUserId: string
  projectId: string
  canvasId: string
  sourceNodeId: string
  idempotencyKey: string
  expectedRevision: number
  clientId: string
  count: number
  title: string
  prompt: string
}): Promise<{ nodeIds: string[]; canvasRevision: number; created: boolean }> {
  if (input.count < 2 || input.count > 4) {
    throw new ApiError('INVALID_PARAMS', { message: '普通画布多图输出数量必须为 2–4 张。' })
  }
  if (!input.idempotencyKey || !input.clientId) {
    throw new ApiError('INVALID_PARAMS', { message: '多图生成缺少幂等键或画布客户端标识。' })
  }
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) {
    throw new ApiError('INVALID_PARAMS', { message: '多图生成缺少有效的画布版本。' })
  }

  const nodeIds = Array.from({ length: input.count }, (_, index) => stableCanvasToolboxOutputNodeId({
    userId: input.userId,
    projectId: input.projectId,
    canvasId: input.canvasId,
    sourceNodeId: input.sourceNodeId,
    idempotencyKey: input.idempotencyKey,
    index,
  }))
  const [canvas, source, incomingEdges] = await Promise.all([
    prisma.canvas.findFirst({
      where: { id: input.canvasId, projectId: input.projectId },
      select: { revision: true },
    }),
    prisma.canvasNode.findFirst({
      where: {
        id: input.sourceNodeId,
        canvasId: input.canvasId,
        type: 'image',
        canvas: { projectId: input.projectId },
      },
      select: {
        id: true,
        type: true,
        position: true,
        size: true,
        data: true,
        parentNodeId: true,
      },
    }),
    prisma.canvasEdge.findMany({
      where: { canvasId: input.canvasId, targetNodeId: input.sourceNodeId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        sourceNodeId: true,
        sourceHandle: true,
        targetHandle: true,
        role: true,
      },
    }),
  ])
  if (!canvas || !source) {
    throw new ApiError('NOT_FOUND', { message: '目标图片节点不存在或不属于当前画布。' })
  }

  const preparedNodeIds = await findPreparedOutputNodeIds(input.canvasId, nodeIds)
  if (preparedNodeIds.length === nodeIds.length) {
    return { nodeIds, canvasRevision: canvas.revision, created: false }
  }
  if (preparedNodeIds.length > 1) {
    throw new ApiError('CONFLICT', { message: '多图输出节点只保存了一部分，请刷新画布后重新生成。' })
  }
  if (canvas.revision !== input.expectedRevision) {
    throw new ApiError('CONFLICT', {
      message: '画布已在另一个标签页更新，请加载最新版本后重新生成。',
      expectedRevision: input.expectedRevision,
      actualRevision: canvas.revision,
    })
  }

  const operations: CanvasOperation[] = []
  nodeIds.slice(1).forEach((nodeId, offset) => {
    const index = offset + 1
    operations.push(outputNodeOperation(source as StoredCanvasNode, {
      nodeId,
      title: input.title,
      prompt: input.prompt,
      index,
    }))
    for (const edge of incomingEdges as StoredCanvasEdge[]) {
      operations.push(outputEdgeOperation(edge, {
        userId: input.userId,
        projectId: input.projectId,
        canvasId: input.canvasId,
        sourceNodeId: input.sourceNodeId,
        outputNodeId: nodeId,
        idempotencyKey: input.idempotencyKey,
      }))
    }
  })

  try {
    const graph = await prisma.$transaction((tx) => applyCanvasOperationsInTransaction(tx, {
      projectId: input.projectId,
      canvasId: input.canvasId,
      userId: input.actorUserId,
      input: {
        expectedRevision: input.expectedRevision,
        clientId: input.clientId,
        changeSummary: `预创建 ${input.count} 个多图生成输出`,
        ops: operations,
      },
    }))
    return { nodeIds, canvasRevision: graph.canvas.revision, created: true }
  } catch (error) {
    // Two identical HTTP attempts can overlap when the first response is lost.
    // If the winning transaction has already committed every stable node, the
    // losing request is an idempotent retry rather than a user-facing conflict.
    const recovered = await findPreparedOutputNodeIds(input.canvasId, nodeIds).catch(() => [])
    if (recovered.length === nodeIds.length) {
      const latest = await prisma.canvas.findFirst({
        where: { id: input.canvasId, projectId: input.projectId },
        select: { revision: true },
      })
      if (latest) return { nodeIds, canvasRevision: latest.revision, created: false }
    }
    throw error
  }
}
