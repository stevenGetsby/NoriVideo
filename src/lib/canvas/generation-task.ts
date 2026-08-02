import { createHash } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { normalizeTaskError } from '@/lib/errors/normalize'
import { prisma } from '@/lib/prisma'
import { TASK_STATUS, TASK_TYPE } from '@/lib/task/types'
import { normalizeCanvasImageGenerationOptions } from '@/lib/canvas/generator-options'

export const CANVAS_GENERATION_TASK_TYPES = [
  TASK_TYPE.CANVAS_TEXT_GENERATION,
  TASK_TYPE.CANVAS_STORYBOARD_PLAN,
] as const

export type CanvasGenerationTaskType = (typeof CANVAS_GENERATION_TASK_TYPES)[number]
export type CanvasGenerationTaskKind = 'text' | 'storyboard_plan'

export type CanvasStoryboardImageRequest = {
  modelKey: string
  modelLabel: string | null
  referenceNodeIds: string[]
  referenceMaterialIds: string[]
  inputMode: 'text' | 'image'
  aspectRatio: string
  resolution: string
  quality: 'low' | 'medium' | 'high'
}

export type CanvasTextGenerationTaskPayload = {
  kind: 'text'
  canvasId: string
  nodeId: string
  prompt: string
  modelKey: string
  analysisModel: string
  maxInputTokens: number
  maxOutputTokens: number
  retryOf: string | null
}

export type CanvasStoryboardPlanTaskPayload = {
  kind: 'storyboard_plan'
  canvasId: string
  nodeId: string
  prompt: string
  count: number
  analysisModel: string
  imageRequest: CanvasStoryboardImageRequest
  maxInputTokens: number
  maxOutputTokens: number
  retryOf: string | null
}

export type CanvasGenerationTaskPayload =
  | CanvasTextGenerationTaskPayload
  | CanvasStoryboardPlanTaskPayload

type CanvasTaskRow = {
  id: string
  type: string
  status: string
  progress: number
  attempt: number
  maxAttempts: number
  payload: unknown
  result: unknown
  errorCode: string | null
  errorMessage: string | null
  queuedAt: Date
  startedAt: Date | null
  finishedAt: Date | null
  updatedAt: Date
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function integer(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, Math.floor(parsed)))
}

function stringArray(value: unknown, maxItems = 24): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value
    .map((item) => text(item, 191))
    .filter(Boolean)))
    .slice(0, maxItems)
}

export function isCanvasGenerationTaskType(value: unknown): value is CanvasGenerationTaskType {
  return value === TASK_TYPE.CANVAS_TEXT_GENERATION || value === TASK_TYPE.CANVAS_STORYBOARD_PLAN
}

export function taskTypeForCanvasGeneration(kind: CanvasGenerationTaskKind): CanvasGenerationTaskType {
  return kind === 'text' ? TASK_TYPE.CANVAS_TEXT_GENERATION : TASK_TYPE.CANVAS_STORYBOARD_PLAN
}

export function parseCanvasGenerationTaskPayload(
  taskType: unknown,
  value: unknown,
): CanvasGenerationTaskPayload | null {
  if (!isCanvasGenerationTaskType(taskType)) return null
  const payload = record(value)
  if (!payload) return null
  const canvasId = text(payload.canvasId, 191)
  const nodeId = text(payload.nodeId, 191)
  const prompt = text(payload.prompt, 30_000)
  const retryOf = text(payload.retryOf, 191) || null
  if (!canvasId || !nodeId || !prompt) return null

  if (taskType === TASK_TYPE.CANVAS_TEXT_GENERATION) {
    const modelKey = text(payload.modelKey, 240) || text(payload.analysisModel, 240)
    if (!modelKey) return null
    return {
      kind: 'text',
      canvasId,
      nodeId,
      prompt,
      modelKey,
      analysisModel: modelKey,
      maxInputTokens: integer(payload.maxInputTokens, 8_000, 1, 60_000),
      maxOutputTokens: integer(payload.maxOutputTokens, 6_000, 1, 30_000),
      retryOf,
    }
  }

  const analysisModel = text(payload.analysisModel, 240)
  const imageRequest = record(payload.imageRequest)
  const modelKey = text(imageRequest?.modelKey, 240)
  if (!analysisModel || !modelKey) return null
  let imageOptions: ReturnType<typeof normalizeCanvasImageGenerationOptions>
  try {
    imageOptions = normalizeCanvasImageGenerationOptions(imageRequest)
  } catch {
    return null
  }
  return {
    kind: 'storyboard_plan',
    canvasId,
    nodeId,
    prompt: prompt.slice(0, 20_000),
    count: integer(payload.count, 4, 4, 8),
    analysisModel,
    imageRequest: {
      modelKey,
      modelLabel: text(imageRequest?.modelLabel, 240) || null,
      referenceNodeIds: stringArray(imageRequest?.referenceNodeIds),
      referenceMaterialIds: stringArray(imageRequest?.referenceMaterialIds),
      inputMode: imageRequest?.inputMode === 'image' ? 'image' : 'text',
      aspectRatio: imageOptions.aspectRatio,
      resolution: imageOptions.resolution,
      quality: imageOptions.quality,
    },
    maxInputTokens: integer(payload.maxInputTokens, 8_000, 1, 60_000),
    maxOutputTokens: integer(payload.maxOutputTokens, 5_000, 1, 30_000),
    retryOf,
  }
}

export function buildCanvasGenerationDedupeKey(
  taskType: CanvasGenerationTaskType,
  payload: CanvasGenerationTaskPayload,
): string {
  const digest = createHash('sha256')
    .update(JSON.stringify({ taskType, ...payload }))
    .digest('hex')
    .slice(0, 32)
  return `canvas-gen:${payload.canvasId.slice(0, 64)}:${payload.nodeId.slice(0, 64)}:${digest}`
}

function historyWithPendingTextTask(
  value: unknown,
  taskId: string,
  payload: CanvasTextGenerationTaskPayload,
): Prisma.InputJsonValue[] {
  const source = Array.isArray(value) ? value : []
  const withoutTask = source.filter((item) => text(record(item)?.taskId, 191) !== taskId)
  return [
    {
      id: `task:${taskId}`,
      taskId,
      text: null,
      prompt: payload.prompt,
      modelKey: payload.modelKey,
      source: 'generation',
      status: 'processing',
      createdAt: new Date().toISOString(),
    },
    ...withoutTask,
  ].slice(0, 40) as Prisma.InputJsonValue[]
}

/**
 * Persist the task association before returning 202. This closes the gap where
 * a tab is refreshed after queue submission but before canvas autosave runs.
 */
export async function bindCanvasGenerationTaskToNode(params: {
  projectId: string
  taskId: string
  runId?: string | null
  payload: CanvasGenerationTaskPayload
  onlyIfUnboundOrSame?: boolean
}) {
  const expectedType = params.payload.kind === 'text'
    ? { in: ['text', 'note'] }
    : 'image'
  const node = await prisma.canvasNode.findFirst({
    where: {
      id: params.payload.nodeId,
      canvasId: params.payload.canvasId,
      type: expectedType,
      canvas: { projectId: params.projectId },
    },
    select: { id: true, data: true, taskId: true },
  })
  if (!node) return false
  if (params.onlyIfUnboundOrSame && node.taskId && node.taskId !== params.taskId) return false

  const current = record(node.data) || {}
  const currentGeneration = record(current.generation) || {}
  if (params.payload.kind === 'storyboard_plan') delete currentGeneration.assetId
  const generation = params.payload.kind === 'text'
    ? {
        ...currentGeneration,
        modelKey: params.payload.modelKey,
        taskId: params.taskId,
      }
    : {
        ...currentGeneration,
        modelKey: params.payload.imageRequest.modelKey,
        modelLabel: params.payload.imageRequest.modelLabel,
        referenceNodeIds: params.payload.imageRequest.referenceNodeIds,
        inputMode: params.payload.imageRequest.inputMode,
        aspectRatio: params.payload.imageRequest.aspectRatio,
        resolution: params.payload.imageRequest.resolution,
        quality: params.payload.imageRequest.quality,
        count: params.payload.count,
        taskId: params.taskId,
      }
  const nextData = {
    ...current,
    prompt: params.payload.prompt,
    ...(params.payload.kind === 'storyboard_plan' ? { processType: 'storyboard' } : {}),
    generation,
    generationTask: {
      kind: params.payload.kind,
      taskId: params.taskId,
      retryOf: params.payload.retryOf,
      submittedAt: new Date().toISOString(),
    },
    progress: 0,
    errorMessage: null,
    pollErrorMessage: null,
    ...(params.payload.kind === 'text'
      ? { history: historyWithPendingTextTask(current.history, params.taskId, params.payload) }
      : {}),
  }
  const updated = await prisma.canvasNode.updateMany({
    where: {
      id: node.id,
      canvasId: params.payload.canvasId,
      ...(params.onlyIfUnboundOrSame
        ? { OR: [{ taskId: null }, { taskId: params.taskId }] }
        : {}),
    },
    data: {
      data: nextData as Prisma.InputJsonValue,
      status: 'RUNNING',
      taskId: params.taskId,
      runId: params.runId || null,
    },
  })
  return updated.count === 1
}

export function serializeCanvasGenerationTask(task: CanvasTaskRow) {
  const payload = parseCanvasGenerationTaskPayload(task.type, task.payload)
  const runtimePayload = record(task.payload)
  const normalizedError = normalizeTaskError(task.errorCode, task.errorMessage)
  return {
    id: task.id,
    type: task.type,
    kind: payload?.kind || null,
    canvasId: payload?.canvasId || null,
    nodeId: payload?.nodeId || null,
    status: task.status,
    progress: task.progress,
    stage: text(runtimePayload?.stage, 120) || null,
    stageLabel: text(runtimePayload?.stageLabel, 240) || null,
    progressDetails: record(runtimePayload?.progressDetails),
    attempt: task.attempt,
    maxAttempts: task.maxAttempts,
    result: record(task.result),
    error: normalizedError
      ? { code: normalizedError.code, message: normalizedError.message, retryable: normalizedError.retryable }
      : null,
    canCancel: task.status === TASK_STATUS.QUEUED || task.status === TASK_STATUS.PROCESSING,
    canRetry: task.status === TASK_STATUS.FAILED || task.status === TASK_STATUS.CANCELED,
    queuedAt: task.queuedAt.toISOString(),
    startedAt: task.startedAt?.toISOString() || null,
    finishedAt: task.finishedAt?.toISOString() || null,
    updatedAt: task.updatedAt.toISOString(),
  }
}

export async function findCanvasGenerationTask(params: {
  taskId: string
  projectId: string
  canvasId: string
  nodeId?: string | null
}) {
  const task = await prisma.task.findFirst({
    where: {
      id: params.taskId,
      projectId: params.projectId,
      targetType: 'CanvasNode',
      ...(params.nodeId ? { targetId: params.nodeId } : {}),
      type: { in: [...CANVAS_GENERATION_TASK_TYPES] },
    },
  })
  const payload = parseCanvasGenerationTaskPayload(task?.type, task?.payload)
  return task
    && payload?.canvasId === params.canvasId
    && (!params.nodeId || payload.nodeId === params.nodeId)
    ? task
    : null
}

export async function findLatestCanvasGenerationTask(params: {
  projectId: string
  canvasId: string
  nodeId: string
}) {
  const tasks = await prisma.task.findMany({
    where: {
      projectId: params.projectId,
      targetType: 'CanvasNode',
      targetId: params.nodeId,
      type: { in: [...CANVAS_GENERATION_TASK_TYPES] },
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
  })
  return tasks.find((task) => {
    const payload = parseCanvasGenerationTaskPayload(task.type, task.payload)
    return payload?.canvasId === params.canvasId && payload.nodeId === params.nodeId
  }) || null
}

export function canvasGenerationTaskLinks(projectId: string, canvasId: string, taskId: string) {
  const base = `/api/projects/${encodeURIComponent(projectId)}/canvas/${encodeURIComponent(canvasId)}/generation-tasks/${encodeURIComponent(taskId)}`
  return { status: base, cancel: base, retry: `${base}/retry` }
}
