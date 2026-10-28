import { createHash } from 'node:crypto'
import { ApiError } from '@/lib/api-errors'
import { applyCanvasOperationsInTransaction } from '@/lib/canvas/persistence'
import type { CanvasOperation } from '@/lib/canvas/operations'
import { prisma } from '@/lib/prisma'

type SyncImageOperation = 'grid_split' | 'lens_focus'

type SyncImageOperationResult = {
  index: number
  row: number
  col: number
  width: number
  height: number
  title: string
  materialId: string
  url: string
}

export type CanvasSyncOperationMaterialization = {
  materialized: boolean
  outputNodeIds: string[]
  canvasRevision: number | null
  reason: 'created' | 'existing' | 'source-missing' | 'revision-conflict'
}

type StoredNode = {
  id: string
  type: string
  position: unknown
  size: unknown
  data: unknown
  status: string
  taskId: string | null
  runId: string | null
  mediaObjectId: string | null
  parentNodeId: string | null
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

export function canvasSyncOperationOutputNodeId(operationRequestId: string, index: number) {
  return stableUuid('canvas-sync-operation-output-node:v1', `${operationRequestId}:${index}`)
}

export function canvasSyncOperationOutputEdgeId(operationRequestId: string, index: number) {
  return stableUuid('canvas-sync-operation-output-edge:v1', `${operationRequestId}:${index}`)
}

export function canvasSyncOperationGroupNodeId(operationRequestId: string) {
  return stableUuid('canvas-sync-operation-group-node:v1', operationRequestId)
}

export function canvasSyncOperationTargetEdgeId(operationRequestId: string) {
  return stableUuid('canvas-sync-operation-target-edge:v1', operationRequestId)
}

function storedNodeInput(node: StoredNode, data: Record<string, unknown>) {
  const position = record(node.position)
  const size = record(node.size)
  return {
    id: node.id,
    type: node.type,
    position: { x: finite(position.x, 0), y: finite(position.y, 0) },
    size: Object.keys(size).length > 0
      ? { width: Math.max(1, finite(size.width, 300)), height: Math.max(1, finite(size.height, 200)) }
      : null,
    data,
    status: node.status,
    taskId: node.taskId,
    runId: node.runId,
    mediaObjectId: node.mediaObjectId,
    parentNodeId: node.parentNodeId,
  }
}

async function currentCanvasState(input: {
  projectId: string
  canvasId: string
  sourceNodeId: string
  targetNodeId?: string
  outputNodeIds: string[]
}) {
  const [canvas, source, target, existingOutputs] = await Promise.all([
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
      select: {
        id: true,
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
    input.targetNodeId
      ? prisma.canvasNode.findFirst({
          where: {
            id: input.targetNodeId,
            canvasId: input.canvasId,
            canvas: { projectId: input.projectId },
          },
          select: {
            id: true,
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
      : Promise.resolve(null),
    prisma.canvasNode.findMany({
      where: { canvasId: input.canvasId, id: { in: input.outputNodeIds } },
      select: { id: true },
    }),
  ])
  return { canvas, source: source as StoredNode | null, target: target as StoredNode | null, existingOutputs }
}

/**
 * Persist local grid/crop results in the same request that creates their
 * materials. A browser can therefore refresh or close as soon as the request
 * completes without leaving successful files detached from the Canvas graph.
 */
export async function materializeCanvasSyncImageOperation(input: {
  userId: string
  projectId: string
  canvasId: string
  sourceNodeId: string
  targetNodeId?: string
  operationRequestId: string
  operation: SyncImageOperation
  results: SyncImageOperationResult[]
}): Promise<CanvasSyncOperationMaterialization> {
  const outputNodeIds = input.results.map((result) => (
    canvasSyncOperationOutputNodeId(input.operationRequestId, result.index)
  ))

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const state = await currentCanvasState({ ...input, outputNodeIds })
    if (!state.canvas || !state.source) {
      return {
        materialized: false,
        outputNodeIds: [],
        canvasRevision: state.canvas?.revision ?? null,
        reason: 'source-missing',
      }
    }
    if (state.existingOutputs.length === outputNodeIds.length) {
      return {
        materialized: true,
        outputNodeIds,
        canvasRevision: state.canvas.revision,
        reason: 'existing',
      }
    }

    const sourcePosition = record(state.source.position)
    const sourceSize = record(state.source.size)
    const sourceData = record(state.source.data)
    const sourceWidth = Math.max(80, finite(sourceSize.width, 300))
    const baseX = finite(sourcePosition.x, 0) + sourceWidth + 92
    const baseY = finite(sourcePosition.y, 0)
    const maxTileWidth = input.operation === 'grid_split' ? 220 : 300
    const outputNodes = input.results.map((result, index) => {
      const width = maxTileWidth
      const height = Math.max(130, Math.min(340, width * result.height / Math.max(1, result.width)))
      return {
        id: outputNodeIds[index],
        type: 'image',
        position: input.operation === 'grid_split'
          ? { x: baseX + result.col * (maxTileWidth + 34), y: baseY + result.row * 210 }
          : { x: baseX, y: baseY },
        size: { width, height },
        data: {
          title: result.title,
          mediaType: 'image',
          origin: 'derivative',
          processType: input.operation,
          contentUrl: result.url,
          imageUrl: result.url,
          materialId: result.materialId,
          canvasOperationRequestId: input.operationRequestId,
          canvasOperationSourceNodeId: input.sourceNodeId,
          generation: {
            referenceNodeIds: [input.sourceNodeId],
            count: 1,
          },
          progress: 100,
          errorMessage: null,
          pollErrorMessage: null,
        },
        status: 'SUCCEEDED',
        taskId: null,
        runId: null,
        mediaObjectId: null,
        parentNodeId: null,
      }
    })
    const operations: CanvasOperation[] = outputNodes.flatMap((node, index) => ([
      { type: 'node.upsert' as const, node },
      {
        type: 'edge.add' as const,
        edge: {
          id: canvasSyncOperationOutputEdgeId(input.operationRequestId, input.results[index].index),
          sourceNodeId: input.sourceNodeId,
          targetNodeId: node.id,
          sourceHandle: 'output',
          targetHandle: 'input',
          role: 'REF',
        },
      },
    ]))

    if (input.operation === 'grid_split' && outputNodes.length > 1) {
      const left = Math.min(...outputNodes.map((node) => node.position.x)) - 30
      const top = Math.min(...outputNodes.map((node) => node.position.y)) - 54
      const right = Math.max(...outputNodes.map((node) => node.position.x + node.size.width)) + 30
      const bottom = Math.max(...outputNodes.map((node) => node.position.y + node.size.height)) + 30
      operations.push({
        type: 'node.upsert',
        node: {
          id: canvasSyncOperationGroupNodeId(input.operationRequestId),
          type: 'group',
          position: { x: left, y: top },
          size: { width: right - left, height: bottom - top },
          data: {
            title: `${typeof sourceData.title === 'string' && sourceData.title.trim() ? sourceData.title : '图片'} · ${outputNodes.length} 宫格`,
            memberIds: outputNodeIds,
            groupColor: null,
          },
          status: 'IDLE',
          taskId: null,
          runId: null,
          mediaObjectId: null,
          parentNodeId: null,
        },
      })
    }

    if (input.operation === 'lens_focus' && state.target && outputNodes[0]) {
      const targetData = record(state.target.data)
      const generation = record(targetData.generation)
      const previousReferences = Array.isArray(generation.referenceNodeIds)
        ? generation.referenceNodeIds.filter((value): value is string => typeof value === 'string' && Boolean(value))
        : []
      operations.push({
        type: 'node.upsert',
        node: storedNodeInput(state.target, {
          ...targetData,
          generation: {
            ...generation,
            referenceNodeIds: Array.from(new Set([...previousReferences, outputNodes[0].id])),
          },
        }),
      })
      operations.push({
        type: 'edge.add',
        edge: {
          id: canvasSyncOperationTargetEdgeId(input.operationRequestId),
          sourceNodeId: outputNodes[0].id,
          targetNodeId: state.target.id,
          sourceHandle: 'output',
          targetHandle: 'input',
          role: 'INPUT_IMAGE',
        },
      })
    }

    const expectedRevision = state.canvas.revision
    try {
      const graph = await prisma.$transaction((tx) => applyCanvasOperationsInTransaction(tx, {
        projectId: input.projectId,
        canvasId: input.canvasId,
        userId: input.userId,
        input: {
          expectedRevision,
          clientId: 'server:canvas-sync-operation',
          changeSummary: input.operation === 'grid_split' ? '宫格切分' : '创建聚焦参考',
          ops: operations,
        },
      }))
      return {
        materialized: true,
        outputNodeIds,
        canvasRevision: graph.canvas.revision,
        reason: 'created',
      }
    } catch (error) {
      const recovered = await prisma.canvasNode.findMany({
        where: { canvasId: input.canvasId, id: { in: outputNodeIds } },
        select: { id: true },
      }).catch(() => [])
      if (recovered.length === outputNodeIds.length) {
        const canvas = await prisma.canvas.findFirst({
          where: { id: input.canvasId, projectId: input.projectId },
          select: { revision: true },
        }).catch(() => null)
        return {
          materialized: true,
          outputNodeIds,
          canvasRevision: canvas?.revision ?? null,
          reason: 'existing',
        }
      }
      if (!(error instanceof ApiError) || error.code !== 'CONFLICT') throw error
    }
  }

  const latest = await prisma.canvas.findFirst({
    where: { id: input.canvasId, projectId: input.projectId },
    select: { revision: true },
  }).catch(() => null)
  return {
    materialized: false,
    outputNodeIds: [],
    canvasRevision: latest?.revision ?? null,
    reason: 'revision-conflict',
  }
}
