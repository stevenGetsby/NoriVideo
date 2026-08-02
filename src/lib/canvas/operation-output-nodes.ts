import { createHash } from 'node:crypto'
import { ApiError } from '@/lib/api-errors'
import { applyCanvasOperationsInTransaction } from '@/lib/canvas/persistence'
import type { CanvasOperation } from '@/lib/canvas/operations'
import type { CanvasAsyncOperation } from '@/lib/canvas/operation-task'
import { prisma } from '@/lib/prisma'

type OperationResult = {
  width: number
  height: number
  title: string
  materialId: string
  url: string
  duration?: number
  fps?: number
}

export type CanvasOperationMaterialization = {
  materialized: boolean
  outputNodeId: string | null
  canvasRevision: number | null
  reason: 'created' | 'existing' | 'source-missing' | 'revision-conflict'
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function finite(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function stableUuid(namespace: string, value: string) {
  const hex = createHash('sha256').update(namespace).update(value).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

export function canvasOperationOutputNodeId(taskId: string) {
  return stableUuid('canvas-operation-output-node:v1', taskId)
}

export function canvasOperationOutputEdgeId(taskId: string) {
  return stableUuid('canvas-operation-output-edge:v1', taskId)
}

function operationLabel(operation: CanvasAsyncOperation, parameters: Record<string, unknown>) {
  if (operation === 'subtitle_erase') return '视频去字幕'
  if (operation === 'video_superresolve') return '视频增强'
  return `图片超清 ${finite(parameters.scale, 2)}×`
}

async function currentCanvasState(input: {
  projectId: string
  canvasId: string
  sourceNodeId: string
  outputNodeId: string
}) {
  const [canvas, source, existingOutput] = await Promise.all([
    prisma.canvas.findFirst({
      where: { id: input.canvasId, projectId: input.projectId },
      select: { revision: true },
    }),
    prisma.canvasNode.findFirst({
      where: {
        id: input.sourceNodeId,
        canvasId: input.canvasId,
        canvas: { projectId: input.projectId },
      },
      select: { id: true, type: true, position: true, size: true, data: true },
    }),
    prisma.canvasNode.findFirst({
      where: { id: input.outputNodeId, canvasId: input.canvasId },
      select: { id: true },
    }),
  ])
  return { canvas, source, existingOutput }
}

/**
 * Persist an asynchronous operation's result as a stable Canvas node before
 * the worker completes. This makes refresh/close recovery independent of the
 * operation dialog and keeps the material and Canvas graph in one durable
 * workflow. Revision conflicts are retried against the newest graph.
 */
export async function materializeCanvasAsyncOperationResult(input: {
  userId: string
  projectId: string
  canvasId: string
  sourceNodeId: string
  taskId: string
  operation: CanvasAsyncOperation
  modelKey: string
  parameters: Record<string, unknown>
  result: OperationResult
}): Promise<CanvasOperationMaterialization> {
  const outputNodeId = canvasOperationOutputNodeId(input.taskId)
  const outputEdgeId = canvasOperationOutputEdgeId(input.taskId)

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const state = await currentCanvasState({ ...input, outputNodeId })
    if (!state.canvas || !state.source) {
      return { materialized: false, outputNodeId: null, canvasRevision: state.canvas?.revision ?? null, reason: 'source-missing' }
    }
    if (state.existingOutput) {
      return { materialized: true, outputNodeId, canvasRevision: state.canvas.revision, reason: 'existing' }
    }

    const sourcePosition = record(state.source.position)
    const sourceSize = record(state.source.size)
    const sourceWidth = Math.max(80, finite(sourceSize.width, 300))
    const width = 300
    const height = Math.max(130, Math.min(340, width * input.result.height / Math.max(1, input.result.width)))
    const mediaType = input.operation === 'superresolve' ? 'image' : 'video'
    const processType = input.operation === 'video_superresolve' ? 'superresolve' : input.operation
    const label = operationLabel(input.operation, input.parameters)
    const now = new Date().toISOString()
    const nodeData = {
      title: input.result.title,
      mediaType,
      origin: 'derivative',
      processType,
      contentUrl: input.result.url,
      ...(mediaType === 'image' ? { imageUrl: input.result.url } : { videoUrl: input.result.url }),
      materialId: input.result.materialId,
      ...(typeof input.result.duration === 'number' ? { duration: input.result.duration } : {}),
      ...(typeof input.result.fps === 'number' ? { fps: input.result.fps } : {}),
      canvasOperationTaskId: input.taskId,
      canvasOperationSourceNodeId: input.sourceNodeId,
      history: [{
        id: `task:${input.taskId}`,
        taskId: input.taskId,
        url: input.result.url,
        materialId: input.result.materialId,
        prompt: label,
        modelKey: input.modelKey,
        source: 'generation',
        status: 'ready',
        errorMessage: null,
        createdAt: now,
      }],
      generation: {
        referenceNodeIds: [input.sourceNodeId],
        count: 1,
        taskId: input.taskId,
        modelKey: input.modelKey,
        parameters: input.parameters,
      },
      progress: 100,
      errorMessage: null,
      pollErrorMessage: null,
    }
    const operations: CanvasOperation[] = [
      {
        type: 'node.upsert',
        node: {
          id: outputNodeId,
          type: mediaType,
          position: {
            x: finite(sourcePosition.x, 0) + sourceWidth + 92,
            y: finite(sourcePosition.y, 0),
          },
          size: { width, height },
          data: nodeData,
          status: 'SUCCEEDED',
          taskId: input.taskId,
          runId: null,
          mediaObjectId: null,
          parentNodeId: null,
        },
      },
      {
        type: 'edge.add',
        edge: {
          id: outputEdgeId,
          sourceNodeId: input.sourceNodeId,
          targetNodeId: outputNodeId,
          sourceHandle: 'output',
          targetHandle: 'input',
          role: 'REF',
        },
      },
    ]

    const expectedRevision = state.canvas.revision
    try {
      const graph = await prisma.$transaction((tx) => applyCanvasOperationsInTransaction(tx, {
        projectId: input.projectId,
        canvasId: input.canvasId,
        userId: input.userId,
        input: {
          expectedRevision,
          clientId: 'worker:canvas-operation',
          changeSummary: label,
          ops: operations,
        },
      }))
      return { materialized: true, outputNodeId, canvasRevision: graph.canvas.revision, reason: 'created' }
    } catch (error) {
      const recovered = await prisma.canvasNode.findFirst({
        where: { id: outputNodeId, canvasId: input.canvasId },
        select: { id: true },
      }).catch(() => null)
      if (recovered) {
        const canvas = await prisma.canvas.findFirst({
          where: { id: input.canvasId, projectId: input.projectId },
          select: { revision: true },
        }).catch(() => null)
        return { materialized: true, outputNodeId, canvasRevision: canvas?.revision ?? null, reason: 'existing' }
      }
      if (!(error instanceof ApiError) || error.code !== 'CONFLICT') throw error
    }
  }

  const latest = await prisma.canvas.findFirst({
    where: { id: input.canvasId, projectId: input.projectId },
    select: { revision: true },
  }).catch(() => null)
  return { materialized: false, outputNodeId: null, canvasRevision: latest?.revision ?? null, reason: 'revision-conflict' }
}
