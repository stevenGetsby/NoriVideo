import { createHash } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { normalizeTaskError } from '@/lib/errors/normalize'
import { extractStorageKey } from '@/lib/storage'
import { TASK_STATUS, TASK_TYPE, type TaskType } from '@/lib/task/types'
import { normalizeCanvasVideoRegion, type CanvasVideoRegion } from './video-operations'

export const CANVAS_ASYNC_OPERATIONS = [
  'superresolve',
  'video_superresolve',
  'subtitle_erase',
] as const

export type CanvasAsyncOperation = (typeof CANVAS_ASYNC_OPERATIONS)[number]

export type CanvasOperationEngine = {
  operation: CanvasAsyncOperation
  engineKey: string
  modelKey: string
  provider: 'local'
  label: string
  description: string
  isDefault: boolean
  capabilities: Record<string, unknown>
}

export type CanvasOperationTaskPayload = {
  canvasId: string
  sourceNodeId: string
  sourceStorageKey: string
  sourceTitle: string
  operation: CanvasAsyncOperation
  engineKey: string
  modelKey: string
  parameters: Record<string, unknown>
  retryOf?: string | null
}

const ENGINES: readonly CanvasOperationEngine[] = [
  {
    operation: 'superresolve',
    engineKey: 'local-sharp',
    modelKey: 'local-sharp',
    provider: 'local',
    label: '本地 Sharp 超清',
    description: '使用 Lanczos 与锐化在本机执行 2×/4× 图片超清，不调用生成模型。',
    isDefault: true,
    capabilities: { scales: [2, 4], maxEdge: 8192 },
  },
  {
    operation: 'video_superresolve',
    engineKey: 'local-ffmpeg',
    modelKey: 'local-ffmpeg',
    provider: 'local',
    label: '本地 FFmpeg 视频增强',
    description: '使用 FFmpeg 缩放、锐化与可选插帧，不调用生成模型。',
    isDefault: true,
    capabilities: { targets: ['2x', '720p', '1080p', '2k', '4k'], interpolation: true, maxEdge: 4096 },
  },
  {
    operation: 'subtitle_erase',
    engineKey: 'local-ffmpeg',
    modelKey: 'local-ffmpeg',
    provider: 'local',
    label: '本地 FFmpeg 去字幕',
    description: '使用选区 delogo 在本机去除字幕或画面文字，不调用生成模型。',
    isDefault: true,
    capabilities: { modes: ['subtitle', 'text'], normalizedRegion: true },
  },
]

const ASYNC_OPERATION_SET = new Set<string>(CANVAS_ASYNC_OPERATIONS)
const CANVAS_TASK_TYPES = new Set<string>([
  TASK_TYPE.CANVAS_IMAGE_OPERATION,
  TASK_TYPE.CANVAS_VIDEO_OPERATION,
])

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function text(value: unknown, max = 500): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

export class CanvasOperationInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CanvasOperationInputError'
  }
}

export function isCanvasAsyncOperation(value: unknown): value is CanvasAsyncOperation {
  return typeof value === 'string' && ASYNC_OPERATION_SET.has(value)
}

export function isCanvasOperationTaskType(value: unknown): value is TaskType {
  return typeof value === 'string' && CANVAS_TASK_TYPES.has(value)
}

export function listCanvasOperationEngines(): CanvasOperationEngine[] {
  return ENGINES.map((engine) => ({
    ...engine,
    capabilities: { ...engine.capabilities },
  }))
}

export function resolveCanvasOperationEngine(
  operation: CanvasAsyncOperation,
  input: Record<string, unknown>,
): CanvasOperationEngine {
  const supported = ENGINES.filter((engine) => engine.operation === operation)
  const defaultEngine = supported.find((engine) => engine.isDefault)
  const requestedEngineKey = text(input.engineKey, 160)
  const requestedModelKey = text(input.modelKey, 160)

  const byEngine = requestedEngineKey
    ? supported.find((engine) => engine.engineKey === requestedEngineKey)
    : null
  const byModel = requestedModelKey
    ? supported.find((engine) => engine.modelKey === requestedModelKey)
    : null

  if (requestedEngineKey && !byEngine) {
    throw new CanvasOperationInputError(`处理引擎 ${requestedEngineKey} 不支持 ${operation}。`)
  }
  if (requestedModelKey && !byModel) {
    throw new CanvasOperationInputError(`处理模型 ${requestedModelKey} 不支持 ${operation}。`)
  }
  if (byEngine && byModel && byEngine.engineKey !== byModel.engineKey) {
    throw new CanvasOperationInputError('engineKey 与 modelKey 指向了不同的处理引擎。')
  }

  const resolved = byEngine || byModel || defaultEngine
  if (!resolved) throw new CanvasOperationInputError(`没有可用于 ${operation} 的处理引擎。`)
  return { ...resolved, capabilities: { ...resolved.capabilities } }
}

export function parseCanvasAsyncOperationInput(value: unknown): {
  operation: CanvasAsyncOperation
  engineKey: string
  modelKey: string
  parameters: Record<string, unknown>
} {
  const input = record(value)
  const operation = input?.operation
  if (!input || !isCanvasAsyncOperation(operation)) {
    throw new CanvasOperationInputError('该操作不是可异步执行的画布处理任务。')
  }
  const engine = resolveCanvasOperationEngine(operation, input)

  if (operation === 'superresolve') {
    const scale = Number(input.scale)
    if (scale !== 2 && scale !== 4) throw new CanvasOperationInputError('超清倍数仅支持 2× 或 4×。')
    return { operation, engineKey: engine.engineKey, modelKey: engine.modelKey, parameters: { scale } }
  }

  if (operation === 'video_superresolve') {
    const requestedTarget = text(input.target, 20) || '1080p'
    const targets = ['2x', '720p', '1080p', '2k', '4k']
    if (!targets.includes(requestedTarget)) throw new CanvasOperationInputError('视频增强目标清晰度无效。')
    return {
      operation,
      engineKey: engine.engineKey,
      modelKey: engine.modelKey,
      parameters: { target: requestedTarget, interpolate: input.interpolate === true },
    }
  }

  const regionInput = record(input.region)
  let region: CanvasVideoRegion
  try {
    region = normalizeCanvasVideoRegion({
      x: Number(regionInput?.x),
      y: Number(regionInput?.y),
      width: Number(regionInput?.width),
      height: Number(regionInput?.height),
    }, text(input.mode, 20) === 'text' ? 'text' : 'subtitle')
  } catch (error) {
    throw new CanvasOperationInputError(error instanceof Error ? error.message : '去字幕区域格式无效。')
  }
  return {
    operation,
    engineKey: engine.engineKey,
    modelKey: engine.modelKey,
    parameters: {
      mode: text(input.mode, 20) === 'text' ? 'text' : 'subtitle',
      region,
    },
  }
}

export function parseCanvasOperationTaskPayload(value: unknown): CanvasOperationTaskPayload | null {
  const payload = record(value)
  const parameters = record(payload?.parameters)
  const operation = payload?.operation
  if (!payload || !parameters || !isCanvasAsyncOperation(operation)) return null

  const canvasId = text(payload.canvasId, 191)
  const sourceNodeId = text(payload.sourceNodeId, 191)
  const sourceStorageKey = text(payload.sourceStorageKey, 2_000)
  const sourceTitle = text(payload.sourceTitle, 160) || (operation === 'superresolve' ? '画布图片' : '画布视频')
  const engineKey = text(payload.engineKey, 160)
  const modelKey = text(payload.modelKey, 160)
  if (!canvasId || !sourceNodeId || !sourceStorageKey || !engineKey || !modelKey) return null

  try {
    const normalized = parseCanvasAsyncOperationInput({
      operation,
      engineKey,
      modelKey,
      ...parameters,
      region: parameters.region,
    })
    return {
      canvasId,
      sourceNodeId,
      sourceStorageKey,
      sourceTitle,
      operation,
      engineKey: normalized.engineKey,
      modelKey: normalized.modelKey,
      parameters: normalized.parameters,
      retryOf: text(payload.retryOf, 191) || null,
    }
  } catch {
    return null
  }
}

export function taskTypeForCanvasOperation(operation: CanvasAsyncOperation): TaskType {
  return operation === 'superresolve'
    ? TASK_TYPE.CANVAS_IMAGE_OPERATION
    : TASK_TYPE.CANVAS_VIDEO_OPERATION
}

export async function resolveCanvasOperationSource(params: {
  userId: string
  projectId: string
  canvasId: string
  sourceNodeId: string
  operation: CanvasAsyncOperation
}): Promise<{ sourceStorageKey: string; sourceTitle: string }> {
  const expectedType = params.operation === 'superresolve' ? 'image' : 'video'
  const sourceNode = await prisma.canvasNode.findFirst({
    where: {
      id: params.sourceNodeId,
      canvasId: params.canvasId,
      type: expectedType,
      canvas: { projectId: params.projectId },
    },
    select: { data: true },
  })
  const nodeData = record(sourceNode?.data)
  if (!sourceNode || !nodeData) throw new CanvasOperationInputError('源媒体节点不存在或类型不匹配。')

  const materialId = text(nodeData.materialId, 191)
  if (materialId) {
    const material = await prisma.frameosMaterial.findFirst({
      where: {
        id: materialId,
        userId: params.userId,
        type: expectedType,
        status: 'ready',
        deletedAt: null,
        projectId: { in: [params.projectId, 'global', 'global-asset-hub'] },
      },
      select: { storageKey: true, resultUrl: true },
    })
    const materialKey = material?.storageKey || extractStorageKey(material?.resultUrl)
    if (materialKey) {
      return {
        sourceStorageKey: materialKey,
        sourceTitle: text(nodeData.title, 160) || (expectedType === 'image' ? '画布图片' : '画布视频'),
      }
    }
  }

  const candidate = text(nodeData.contentUrl, 2_000)
    || text(expectedType === 'image' ? nodeData.imageUrl : nodeData.videoUrl, 2_000)
  const storageKey = extractStorageKey(candidate)
  if (!storageKey) {
    throw new CanvasOperationInputError(`源${expectedType === 'image' ? '图片' : '视频'}尚未保存到素材库，无法执行处理。`)
  }
  return {
    sourceStorageKey: storageKey,
    sourceTitle: text(nodeData.title, 160) || (expectedType === 'image' ? '画布图片' : '画布视频'),
  }
}

export function buildCanvasOperationDedupeKey(payload: CanvasOperationTaskPayload): string {
  const digest = createHash('sha256')
    .update(JSON.stringify({
      canvasId: payload.canvasId,
      sourceNodeId: payload.sourceNodeId,
      sourceStorageKey: payload.sourceStorageKey,
      operation: payload.operation,
      engineKey: payload.engineKey,
      modelKey: payload.modelKey,
      parameters: payload.parameters,
      retryOf: payload.retryOf || null,
    }))
    .digest('hex')
    .slice(0, 32)
  return `canvas-op:${payload.canvasId.slice(0, 72)}:${digest}`
}

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

export function serializeCanvasOperationTask(task: CanvasTaskRow) {
  const payload = parseCanvasOperationTaskPayload(task.payload)
  const runtimePayload = record(task.payload)
  const normalizedError = normalizeTaskError(task.errorCode, task.errorMessage)
  return {
    id: task.id,
    type: task.type,
    operation: payload?.operation || null,
    engineKey: payload?.engineKey || null,
    modelKey: payload?.modelKey || null,
    sourceNodeId: payload?.sourceNodeId || null,
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

export async function findCanvasOperationTask(params: {
  taskId: string
  userId: string
  projectId: string
  canvasId: string
}) {
  const task = await prisma.task.findFirst({
    where: {
      id: params.taskId,
      userId: params.userId,
      projectId: params.projectId,
      targetType: 'CanvasNode',
      type: { in: [TASK_TYPE.CANVAS_IMAGE_OPERATION, TASK_TYPE.CANVAS_VIDEO_OPERATION] },
    },
  })
  const payload = parseCanvasOperationTaskPayload(task?.payload)
  return task && payload?.canvasId === params.canvasId ? task : null
}

export async function findLatestCanvasOperationTask(params: {
  userId: string
  projectId: string
  canvasId: string
  sourceNodeId: string
  operation?: CanvasAsyncOperation | null
}) {
  const tasks = await prisma.task.findMany({
    where: {
      userId: params.userId,
      projectId: params.projectId,
      targetType: 'CanvasNode',
      targetId: params.sourceNodeId,
      type: { in: [TASK_TYPE.CANVAS_IMAGE_OPERATION, TASK_TYPE.CANVAS_VIDEO_OPERATION] },
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
  })
  return tasks.find((task) => {
    const payload = parseCanvasOperationTaskPayload(task.payload)
    return payload?.canvasId === params.canvasId
      && (!params.operation || payload.operation === params.operation)
  }) || null
}

export function canvasOperationTaskLinks(projectId: string, canvasId: string, taskId: string) {
  const base = `/api/projects/${encodeURIComponent(projectId)}/canvas/${encodeURIComponent(canvasId)}/operations/tasks/${encodeURIComponent(taskId)}`
  return { status: base, cancel: base, retry: `${base}/retry` }
}
