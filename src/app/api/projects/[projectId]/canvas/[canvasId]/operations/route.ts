import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError, getRequestId } from '@/lib/api-errors'
import { isErrorResponse, requireProjectAuthLight } from '@/lib/api-auth'
import { requireCanvasInProject } from '@/lib/canvas/access'
import { cropCanvasImage, splitCanvasImage, type CanvasImageTile } from '@/lib/canvas/image-operations'
import { materializeCanvasSyncImageOperation } from '@/lib/canvas/sync-operation-output-nodes'
import {
  buildCanvasOperationDedupeKey,
  canvasOperationTaskLinks,
  findCanvasOperationTask,
  findLatestCanvasOperationTask,
  isCanvasAsyncOperation,
  listCanvasOperationEngines,
  parseCanvasAsyncOperationInput,
  resolveCanvasOperationSource,
  serializeCanvasOperationTask,
  taskTypeForCanvasOperation,
  type CanvasAsyncOperation,
  type CanvasOperationTaskPayload,
} from '@/lib/canvas/operation-task'
import { registerFrameosMaterial } from '@/lib/frameos/material-service'
import { prisma } from '@/lib/prisma'
import { extractStorageKey, generateUniqueKey, getObjectBuffer, uploadObject } from '@/lib/storage'
import { resolveRequiredTaskLocale } from '@/lib/task/resolve-locale'
import { submitTask } from '@/lib/task/submitter'

type Operation = 'grid_split' | 'lens_focus' | 'superresolve' | 'video_superresolve' | 'subtitle_erase'

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export const GET = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string; canvasId: string }> },
) => {
  const { projectId, canvasId } = await context.params
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult
  await requireCanvasInProject(canvasId, projectId)

  const sourceNodeId = text(request.nextUrl.searchParams.get('sourceNodeId'))
  const operationQuery = text(request.nextUrl.searchParams.get('operation'))
  let operationFilter: CanvasAsyncOperation | null = null
  if (operationQuery && !isCanvasAsyncOperation(operationQuery)) {
    throw new ApiError('INVALID_PARAMS', { message: '要恢复的画布处理类型无效。' })
  }
  if (isCanvasAsyncOperation(operationQuery)) operationFilter = operationQuery
  if (operationQuery && !sourceNodeId) {
    throw new ApiError('INVALID_PARAMS', { message: '按操作恢复任务时必须提供 sourceNodeId。' })
  }

  const latestTask = sourceNodeId
    ? await findLatestCanvasOperationTask({
      userId: authResult.session.user.id,
      projectId,
      canvasId,
      sourceNodeId,
      operation: operationFilter,
    })
    : null

  return NextResponse.json({
    asyncOperations: ['superresolve', 'video_superresolve', 'subtitle_erase'],
    engines: listCanvasOperationEngines(),
    latestTask: latestTask ? serializeCanvasOperationTask(latestTask) : null,
    links: latestTask ? canvasOperationTaskLinks(projectId, canvasId, latestTask.id) : null,
    taskContract: {
      create: `/api/projects/${projectId}/canvas/${canvasId}/operations`,
      status: `/api/projects/${projectId}/canvas/${canvasId}/operations/tasks/{taskId}`,
      cancel: `/api/projects/${projectId}/canvas/${canvasId}/operations/tasks/{taskId}`,
      retry: `/api/projects/${projectId}/canvas/${canvasId}/operations/tasks/{taskId}/retry`,
    },
  })
})

async function sourceMediaBuffer({
  userId,
  projectId,
  nodeData,
  type,
}: {
  userId: string
  projectId: string
  nodeData: Record<string, unknown>
  type: 'image' | 'video'
}) {
  const materialId = text(nodeData.materialId)
  if (materialId) {
    const material = await prisma.frameosMaterial.findFirst({
      where: {
        id: materialId,
        userId,
        type,
        status: 'ready',
        deletedAt: null,
        projectId: { in: [projectId, 'global', 'global-asset-hub'] },
      },
      select: { storageKey: true, resultUrl: true },
    })
    const key = material?.storageKey || extractStorageKey(material?.resultUrl)
    if (key) return await getObjectBuffer(key)
  }

  const candidate = text(nodeData.contentUrl) || text(type === 'image' ? nodeData.imageUrl : nodeData.videoUrl)
  const key = extractStorageKey(candidate)
  if (key) return await getObjectBuffer(key)
  throw new ApiError('INVALID_PARAMS', { message: `源${type === 'image' ? '图片' : '视频'}尚未保存到素材库，无法执行处理。` })
}

async function persistTiles({
  tiles,
  userId,
  ownerName,
  projectId,
  sourceNodeId,
  sourceTitle,
  operation,
}: {
  tiles: CanvasImageTile[]
  userId: string
  ownerName: string | null | undefined
  projectId: string
  sourceNodeId: string
  sourceTitle: string
  operation: Operation
}) {
  return await Promise.all(tiles.map(async (tile, index) => {
    const suffix = operation === 'grid_split'
      ? `${tile.row + 1}-${tile.col + 1}`
      : operation === 'lens_focus' ? '聚焦' : '超清'
    const title = `${sourceTitle} · ${suffix}`
    const storageKey = generateUniqueKey(`canvas-${operation}-${userId}`, 'jpg')
    await uploadObject(tile.body, storageKey, undefined, 'image/jpeg')
    const material = await registerFrameosMaterial({
      userId,
      projectId,
      ownerName,
      title,
      type: 'image',
      source: 'creative',
      storageKey,
      metadata: {
        originType: 'canvas-operation',
        sourceNodeId,
        operation,
        row: tile.row,
        col: tile.col,
        width: tile.width,
        height: tile.height,
      },
    })
    return {
      index,
      row: tile.row,
      col: tile.col,
      width: tile.width,
      height: tile.height,
      title: material.title || title,
      materialId: material.id,
      url: material.resultUrl || material.storageKey || storageKey,
    }
  }))
}

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string; canvasId: string }> },
) => {
  const { projectId, canvasId } = await context.params
  const authResult = await requireProjectAuthLight(projectId, ['canvasWrite'])
  if (isErrorResponse(authResult)) return authResult
  await requireCanvasInProject(canvasId, projectId)
  const body = await request.json().catch(() => null)
  const input = record(body)
  const operation = text(input?.operation) as Operation
  const sourceNodeId = text(input?.sourceNodeId)
  if (!sourceNodeId || !['grid_split', 'lens_focus', 'superresolve', 'video_superresolve', 'subtitle_erase'].includes(operation)) {
    throw new ApiError('INVALID_PARAMS', { message: '画布处理参数无效。' })
  }

  if (isCanvasAsyncOperation(operation)) {
    let parsed: ReturnType<typeof parseCanvasAsyncOperationInput>
    let sourceDescriptor: Awaited<ReturnType<typeof resolveCanvasOperationSource>>
    try {
      parsed = parseCanvasAsyncOperationInput(input)
      sourceDescriptor = await resolveCanvasOperationSource({
        userId: authResult.session.user.id,
        projectId,
        canvasId,
        sourceNodeId,
        operation,
      })
    } catch (error) {
      throw new ApiError('INVALID_PARAMS', {
        message: error instanceof Error ? error.message : '画布处理参数无效。',
      })
    }

    const payload: CanvasOperationTaskPayload = {
      canvasId,
      sourceNodeId,
      sourceStorageKey: sourceDescriptor.sourceStorageKey,
      sourceTitle: sourceDescriptor.sourceTitle,
      operation,
      engineKey: parsed.engineKey,
      modelKey: parsed.modelKey,
      parameters: parsed.parameters,
      retryOf: null,
    }
    const submitResult = await submitTask({
      userId: authResult.session.user.id,
      locale: resolveRequiredTaskLocale(request, input),
      requestId: getRequestId(request),
      projectId,
      type: taskTypeForCanvasOperation(operation),
      targetType: 'CanvasNode',
      targetId: sourceNodeId,
      payload,
      dedupeKey: buildCanvasOperationDedupeKey(payload),
      maxAttempts: 1,
    })
    const task = await findCanvasOperationTask({
      taskId: submitResult.taskId,
      userId: authResult.session.user.id,
      projectId,
      canvasId,
    })
    if (!task) throw new ApiError('INTERNAL_ERROR', { message: '画布处理任务创建后无法读取。' })
    return NextResponse.json({
      success: true,
      async: true,
      operation,
      engineKey: parsed.engineKey,
      modelKey: parsed.modelKey,
      taskId: task.id,
      task: serializeCanvasOperationTask(task),
      links: canvasOperationTaskLinks(projectId, canvasId, task.id),
    }, { status: 202 })
  }

  const sourceType = 'image'
  const sourceNode = await prisma.canvasNode.findFirst({
    where: { id: sourceNodeId, canvasId, type: sourceType },
    select: { id: true, data: true },
  })
  const nodeData = record(sourceNode?.data)
  if (!sourceNode || !nodeData) throw new ApiError('NOT_FOUND')
  const source = await sourceMediaBuffer({ userId: authResult.session.user.id, projectId, nodeData, type: sourceType })

  let tiles: CanvasImageTile[]
  if (operation === 'grid_split') {
    const rows = Number(input?.rows)
    const cols = Number(input?.cols)
    const selectedCells = Array.isArray(input?.selectedCells)
      ? input.selectedCells.map((cell) => {
        const value = record(cell)
        return { row: Number(value?.row), col: Number(value?.col) }
      })
      : undefined
    try {
      tiles = await splitCanvasImage(source, rows, cols, selectedCells)
    } catch (error) {
      throw new ApiError('INVALID_PARAMS', { message: error instanceof Error ? error.message : '宫格切分失败' })
    }
  } else if (operation === 'lens_focus') {
    const crop = record(input?.crop)
    try {
      tiles = [await cropCanvasImage(source, {
        x: Number(crop?.x),
        y: Number(crop?.y),
        width: Number(crop?.width),
        height: Number(crop?.height),
      })]
    } catch (error) {
      throw new ApiError('INVALID_PARAMS', { message: error instanceof Error ? error.message : '聚焦裁切失败' })
    }
  } else {
    throw new ApiError('INVALID_PARAMS', { message: '画布图片处理参数无效。' })
  }

  const results = await persistTiles({
    tiles,
    userId: authResult.session.user.id,
    ownerName: authResult.session.user.name,
    projectId,
    sourceNodeId,
    sourceTitle: text(nodeData.title) || '画布图片',
    operation,
  })
  const operationRequestId = text(input?.operationRequestId) || randomUUID()
  const targetNodeId = text(input?.targetNodeId) || undefined
  const materialization = await materializeCanvasSyncImageOperation({
    userId: authResult.session.user.id,
    projectId,
    canvasId,
    sourceNodeId,
    targetNodeId,
    operationRequestId: operationRequestId.slice(0, 120),
    operation,
    results,
  })
  return NextResponse.json({ success: true, operation, operationRequestId, results, materialization })
})
