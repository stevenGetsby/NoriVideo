import { apiFetch } from '@/lib/api-fetch'
import { resolveTaskErrorMessage } from '@/lib/task/error-message'

export type CanvasGenerationTaskStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'canceled'
export type CanvasGenerationTaskKind = 'text' | 'storyboard_plan'

export type CanvasStoryboardPlanShot = {
  index: number
  title: string
  prompt: string
}

export type CanvasGenerationTask = {
  id: string
  type: string
  kind: CanvasGenerationTaskKind | null
  canvasId: string | null
  nodeId: string | null
  status: CanvasGenerationTaskStatus
  progress: number
  stage: string | null
  stageLabel: string | null
  progressDetails: Record<string, unknown> | null
  attempt: number
  maxAttempts: number
  result: {
    text?: string
    modelKey?: string
    shots?: CanvasStoryboardPlanShot[]
    imageRequest?: {
      modelKey?: string
      modelLabel?: string | null
      referenceNodeIds?: string[]
      referenceMaterialIds?: string[]
      inputMode?: 'text' | 'image'
      aspectRatio?: string
      resolution?: string
      quality?: 'low' | 'medium' | 'high'
    }
    fanout?: {
      planningTaskId?: string
      groupId?: string
      status?: 'submitted' | 'partial' | 'failed'
      submittedCount?: number
      failedCount?: number
      shots?: Array<{
        index?: number
        nodeId?: string
        assetId?: string | null
        taskId?: string | null
        status?: 'submitted' | 'ready' | 'failed'
        errorMessage?: string | null
      }>
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

export type CanvasGenerationTaskLinks = {
  status: string
  cancel: string
  retry: string
}

export type CanvasGenerationTaskUpdate = {
  task: CanvasGenerationTask
  links: CanvasGenerationTaskLinks
}

type AsyncCanvasGenerationResponse = {
  async: true
  taskId: string
  runId?: string | null
  task: CanvasGenerationTask
  links: CanvasGenerationTaskLinks
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

export function parseCanvasGenerationTaskUpdate(value: unknown): CanvasGenerationTaskUpdate | null {
  const source = record(value)
  const task = record(source?.task)
  const links = record(source?.links)
  if (!task || !links || typeof task.id !== 'string' || typeof task.status !== 'string') return null
  if (typeof links.status !== 'string' || typeof links.cancel !== 'string' || typeof links.retry !== 'string') return null
  return {
    task: task as unknown as CanvasGenerationTask,
    links: links as unknown as CanvasGenerationTaskLinks,
  }
}

export async function readCanvasGenerationSubmission(response: Response): Promise<{
  taskId: string
  runId: string | null
  update: CanvasGenerationTaskUpdate
}> {
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(resolveTaskErrorMessage(payload, '画布生成任务提交失败'))
  const source = record(payload) as AsyncCanvasGenerationResponse | null
  const update = parseCanvasGenerationTaskUpdate(payload)
  if (!source || source.async !== true || typeof source.taskId !== 'string' || !update) {
    throw new Error('画布生成任务返回格式无效')
  }
  return {
    taskId: source.taskId,
    runId: typeof source.runId === 'string' ? source.runId : null,
    update,
  }
}

export async function fetchCanvasGenerationTask(statusUrl: string): Promise<CanvasGenerationTaskUpdate> {
  const response = await apiFetch(statusUrl, { cache: 'no-store' })
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(resolveTaskErrorMessage(payload, '读取画布生成进度失败'))
  const update = parseCanvasGenerationTaskUpdate(payload)
  if (!update) throw new Error('画布生成任务状态格式无效')
  return update
}

export async function cancelCanvasGenerationTask(
  projectId: string,
  canvasId: string,
  taskId: string,
): Promise<CanvasGenerationTaskUpdate> {
  const response = await apiFetch(`/api/projects/${encodeURIComponent(projectId)}/canvas/${encodeURIComponent(canvasId)}/generation-tasks/${encodeURIComponent(taskId)}`, {
    method: 'DELETE',
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(resolveTaskErrorMessage(payload, '取消画布生成任务失败'))
  const update = parseCanvasGenerationTaskUpdate(payload)
  if (!update) throw new Error('取消任务返回格式无效')
  return update
}

export async function retryCanvasGenerationTask(
  projectId: string,
  canvasId: string,
  taskId: string,
): Promise<ReturnType<typeof readCanvasGenerationSubmission> extends Promise<infer T> ? T : never> {
  const response = await apiFetch(`/api/projects/${encodeURIComponent(projectId)}/canvas/${encodeURIComponent(canvasId)}/generation-tasks/${encodeURIComponent(taskId)}/retry`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
  return readCanvasGenerationSubmission(response)
}

export function canvasGenerationTaskError(task: CanvasGenerationTask, fallback = '画布生成失败') {
  return task.error?.message || resolveTaskErrorMessage(task, fallback)
}
