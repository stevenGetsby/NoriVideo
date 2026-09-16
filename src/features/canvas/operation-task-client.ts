import { apiFetch } from '@/lib/api-fetch'
import { resolveTaskErrorMessage } from '@/lib/task/error-message'

export type CanvasOperationTaskStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'canceled'

export type CanvasOperationResult = {
  index: number
  row: number
  col: number
  width: number
  height: number
  title: string
  materialId: string
  url: string
  duration?: number
  fps?: number
}

export type CanvasOperationEngine = {
  operation: 'superresolve' | 'video_superresolve' | 'subtitle_erase' | 'video_edit'
  engineKey: string
  modelKey: string
  provider: string
  label: string
  description: string
  isDefault: boolean
  capabilities: Record<string, unknown>
}

export type CanvasOperationTask = {
  id: string
  type: string
  operation: 'superresolve' | 'video_superresolve' | 'subtitle_erase' | 'video_edit' | null
  engineKey: string | null
  modelKey: string | null
  sourceNodeId: string | null
  status: CanvasOperationTaskStatus
  progress: number
  stage: string | null
  stageLabel: string | null
  progressDetails: Record<string, unknown> | null
  attempt: number
  maxAttempts: number
  result: {
    results?: CanvasOperationResult[]
    materialization?: {
      materialized: boolean
      outputNodeId: string | null
      canvasRevision: number | null
      reason: 'created' | 'existing' | 'source-missing' | 'revision-conflict'
    }
  } | null
  error: { code: string; message: string; retryable: boolean } | null
  canCancel: boolean
  canRetry: boolean
  queuedAt: string
  startedAt: string | null
  finishedAt: string | null
  updatedAt: string
}

export type CanvasOperationTaskLinks = {
  status: string
  cancel: string
  retry: string
}

export type CanvasOperationTaskUpdate = {
  task: CanvasOperationTask
  links: CanvasOperationTaskLinks
}

export type CanvasOperationConfig = {
  asyncOperations: string[]
  engines: CanvasOperationEngine[]
  latestTask?: CanvasOperationTask | null
  latestTaskLinks?: CanvasOperationTaskLinks | null
}

export type ResolvedCanvasOperation = {
  results?: CanvasOperationResult[]
  materialization?: NonNullable<CanvasOperationTask['result']>['materialization'] | {
    materialized: boolean
    outputNodeIds: string[]
    canvasRevision: number | null
    reason: 'created' | 'existing' | 'source-missing' | 'revision-conflict'
  }
  taskUpdate?: CanvasOperationTaskUpdate
}

type AsyncCanvasOperationResponse = {
  async: true
  taskId: string
  task: CanvasOperationTask
  links: CanvasOperationTaskLinks
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function isAsyncResponse(value: unknown): value is AsyncCanvasOperationResponse {
  const source = record(value)
  return source?.async === true
    && typeof source.taskId === 'string'
    && Boolean(record(source.task))
    && Boolean(record(source.links))
}

function taskError(task: CanvasOperationTask) {
  return task.error?.message || resolveTaskErrorMessage(task, `画布处理任务${task.status === 'canceled' ? '已取消' : '失败'}`)
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

export async function loadCanvasOperationConfig(
  endpoint: string,
  options?: { sourceNodeId?: string; operation?: string },
): Promise<CanvasOperationConfig> {
  const query = new URLSearchParams()
  if (options?.sourceNodeId) query.set('sourceNodeId', options.sourceNodeId)
  if (options?.operation) query.set('operation', options.operation)
  const response = await apiFetch(`${endpoint}${query.size ? `?${query}` : ''}`, { cache: 'no-store' })
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(resolveTaskErrorMessage(payload, '加载画布处理引擎失败'))
  const source = record(payload)
  return {
    asyncOperations: Array.isArray(source?.asyncOperations) ? source.asyncOperations.filter((item): item is string => typeof item === 'string') : [],
    engines: Array.isArray(source?.engines) ? source.engines as CanvasOperationEngine[] : [],
    latestTask: record(source?.latestTask) as CanvasOperationTask | null,
    latestTaskLinks: (record(source?.latestTaskLinks) || record(source?.links)) as CanvasOperationTaskLinks | null,
  }
}

export async function waitForCanvasOperationTask(
  update: CanvasOperationTaskUpdate,
  onUpdate?: (update: CanvasOperationTaskUpdate) => void,
): Promise<ResolvedCanvasOperation> {
  let current = update
  onUpdate?.(current)
  while (current.task.status === 'queued' || current.task.status === 'processing') {
    await sleep(1_000)
    const response = await apiFetch(current.links.status, { cache: 'no-store' })
    const payload = await response.json().catch(() => null)
    if (!response.ok) throw new Error(resolveTaskErrorMessage(payload, '读取画布处理进度失败'))
    const source = record(payload)
    const task = source?.task as CanvasOperationTask | undefined
    const links = source?.links as CanvasOperationTaskLinks | undefined
    if (!task || !links) throw new Error('画布处理任务返回格式无效')
    current = { task, links }
    onUpdate?.(current)
  }
  if (current.task.status === 'completed') return { ...(current.task.result || {}), taskUpdate: current }
  throw new Error(taskError(current.task))
}

export async function resolveCanvasOperationResponse(
  response: Response,
  onUpdate?: (update: CanvasOperationTaskUpdate) => void,
): Promise<ResolvedCanvasOperation> {
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(resolveTaskErrorMessage(payload, '画布处理失败'))
  if (!isAsyncResponse(payload)) return (payload || {}) as ResolvedCanvasOperation
  return await waitForCanvasOperationTask({ task: payload.task, links: payload.links }, onUpdate)
}

export async function cancelCanvasOperationTask(update: CanvasOperationTaskUpdate) {
  const response = await apiFetch(update.links.cancel, { method: 'DELETE' })
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(resolveTaskErrorMessage(payload, '取消画布处理任务失败'))
  const source = record(payload)
  const task = source?.task as CanvasOperationTask | undefined
  const links = source?.links as CanvasOperationTaskLinks | undefined
  if (!task || !links) throw new Error('取消任务返回格式无效')
  return { task, links } satisfies CanvasOperationTaskUpdate
}

export async function retryCanvasOperationTask(
  update: CanvasOperationTaskUpdate,
  onUpdate?: (update: CanvasOperationTaskUpdate) => void,
) {
  const response = await apiFetch(update.links.retry, { method: 'POST' })
  return await resolveCanvasOperationResponse(response, onUpdate)
}
