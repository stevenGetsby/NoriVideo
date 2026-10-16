import type { Prisma } from '@prisma/client'
import { cnyToPoints } from '@/lib/billing'
import { prisma } from '@/lib/prisma'
import {
  isCanvasGenerationTaskType,
  parseCanvasGenerationTaskPayload,
} from '@/lib/canvas/generation-task'
import { TASK_STATUS } from '@/lib/task/types'

type ReconciliableCanvasNode = {
  id: string
  status: string
  taskId: string | null
  data: Prisma.JsonValue | null
  updatedAt: Date
}

type ToolboxAssetState = {
  id: string
  type: string
  status: string
  resultUrl: string | null
  materialId: string | null
  errorMessage: string | null
}

type ToolboxTaskState = {
  id: string
  targetId: string
  status: string
  progress: number
  errorMessage: string | null
  billingInfo: unknown
}

type TerminalGenerationState =
  | {
      status: 'SUCCEEDED'
      resultUrl: string
      materialId: string | null
      mediaType: string
      progress: 100
      errorMessage: null
    }
  | {
      status: 'FAILED'
      resultUrl: null
      materialId: null
      mediaType: string | null
      progress: number
      errorMessage: string
    }

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function completedTaskCostPoints(task: { billingInfo: unknown; status: string }): number | null {
  const info = record(task.billingInfo)
  if (!info || info.billable !== true || task.status !== TASK_STATUS.COMPLETED) return null
  const cost = Number(info.chargedCost)
  if (!Number.isFinite(cost) || cost < 0) return null
  return cnyToPoints(cost)
}

function generationAssetId(node: ReconciliableCanvasNode): string {
  if (node.status !== 'RUNNING') return ''
  const data = record(node.data)
  const generation = record(data?.generation)
  return cleanText(generation?.assetId)
}

function generationTaskId(node: ReconciliableCanvasNode): string {
  if (node.status !== 'RUNNING') return ''
  const data = record(node.data)
  const generation = record(data?.generation)
  if (cleanText(generation?.assetId)) return ''
  const generationTask = record(data?.generationTask)
  return cleanText(node.taskId) || cleanText(generationTask?.taskId) || cleanText(generation?.taskId)
}

function terminalState(
  asset: ToolboxAssetState | undefined,
  task: ToolboxTaskState | undefined,
): TerminalGenerationState | null {
  const assetStatus = cleanText(asset?.status).toLowerCase()
  const taskStatus = cleanText(task?.status).toLowerCase()
  const resultUrl = cleanText(asset?.resultUrl)

  // A persisted toolbox result is the strongest truth, even if a stale task row
  // happens to disagree with it.
  if (assetStatus === 'ready' && resultUrl) {
    return {
      status: 'SUCCEEDED',
      resultUrl,
      materialId: asset?.materialId || null,
      mediaType: asset?.type || '',
      progress: 100,
      errorMessage: null,
    }
  }

  // Toolbox workers may mark the asset attempt as failed before BullMQ retries
  // it. An active Task therefore wins over that transient asset status.
  if (taskStatus === TASK_STATUS.QUEUED || taskStatus === TASK_STATUS.PROCESSING) return null

  const taskFailed = taskStatus === TASK_STATUS.FAILED
    || taskStatus === TASK_STATUS.CANCELED
    || taskStatus === TASK_STATUS.DISMISSED
  const completedWithoutMedia = taskStatus === TASK_STATUS.COMPLETED
  const assetFailed = assetStatus === 'failed'
  const readyWithoutMedia = assetStatus === 'ready' && !resultUrl
  if (!assetFailed && !taskFailed && !completedWithoutMedia && !readyWithoutMedia) return null

  const fallback = taskStatus === TASK_STATUS.CANCELED
    ? '生成任务已取消'
    : taskStatus === TASK_STATUS.DISMISSED
      ? '生成任务已终止'
      : completedWithoutMedia || readyWithoutMedia
        ? '生成任务已完成，但没有返回可用媒体'
        : '生成失败'
  return {
    status: 'FAILED',
    resultUrl: null,
    materialId: null,
    mediaType: asset?.type || null,
    progress: Math.max(0, Math.min(100, task?.progress || 0)),
    errorMessage: cleanText(asset?.errorMessage) || cleanText(task?.errorMessage) || fallback,
  }
}

function reconcileNodeData(
  value: Prisma.JsonValue | null,
  assetId: string,
  terminal: TerminalGenerationState,
  costPoints: number | null,
): Prisma.InputJsonValue {
  const current = record(value) || {}
  const history = Array.isArray(current.history)
    ? current.history.map((item) => {
        const entry = record(item)
        if (!entry || cleanText(entry.assetId) !== assetId) return item
        return terminal.status === 'SUCCEEDED'
          ? {
              ...entry,
              status: 'ready',
              url: terminal.resultUrl,
              materialId: terminal.materialId,
              errorMessage: null,
              ...(costPoints !== null ? { actualCostPoints: costPoints } : {}),
            }
          : {
              ...entry,
              status: 'failed',
              errorMessage: terminal.errorMessage,
            }
      })
    : current.history

  const next: Record<string, unknown> = {
    ...current,
    progress: terminal.progress,
    errorMessage: terminal.errorMessage,
    pollErrorMessage: null,
    ...(history !== undefined ? { history } : {}),
  }
  if (terminal.status === 'SUCCEEDED') {
    next.contentUrl = terminal.resultUrl
    next.materialId = terminal.materialId
    if (terminal.mediaType === 'image') next.imageUrl = terminal.resultUrl
    if (terminal.mediaType === 'video') next.videoUrl = terminal.resultUrl
    if (terminal.mediaType === 'audio') next.audioUrl = terminal.resultUrl
    if (terminal.mediaType === 'model3d') next.modelUrl = terminal.resultUrl
  }
  return next as Prisma.InputJsonValue
}

/**
 * Reconciles persisted RUNNING canvas nodes with the existing toolbox asset/task
 * records. It does not create another job state; it only projects terminal task
 * truth back onto the canvas document when that document is read.
 */
export async function reconcileCanvasGenerationNodes<T extends ReconciliableCanvasNode>({
  projectId,
  canvasId,
  nodes,
}: {
  projectId: string
  canvasId: string
  nodes: T[]
}): Promise<T[]> {
  const assetIds = Array.from(new Set(nodes.map(generationAssetId).filter(Boolean)))
  if (assetIds.length === 0) {
    return await reconcileCanvasTextGenerationNodes({ projectId, canvasId, nodes })
  }

  const [assets, tasks] = await Promise.all([
    prisma.frameosToolboxAsset.findMany({
      where: { id: { in: assetIds }, projectId },
      select: {
        id: true,
        type: true,
        status: true,
        resultUrl: true,
        materialId: true,
        errorMessage: true,
      },
    }),
    prisma.task.findMany({
      where: {
        projectId,
        targetType: 'FrameosToolboxAsset',
        targetId: { in: assetIds },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        targetId: true,
        status: true,
        progress: true,
        errorMessage: true,
        billingInfo: true,
      },
    }),
  ])
  const assetById = new Map(assets.map((asset) => [asset.id, asset]))
  const taskByAssetId = new Map<string, ToolboxTaskState>()
  for (const task of tasks) {
    if (!taskByAssetId.has(task.targetId)) taskByAssetId.set(task.targetId, task)
  }

  const candidates: Array<{
    node: T
    next: T
    write: ReturnType<typeof prisma.canvasNode.updateMany>
  }> = []
  for (const node of nodes) {
    const assetId = generationAssetId(node)
    if (!assetId) continue
    const task = taskByAssetId.get(assetId)
    const terminal = terminalState(assetById.get(assetId), task)
    if (!terminal) continue
    const data = reconcileNodeData(node.data, assetId, terminal, task ? completedTaskCostPoints(task) : null)
    const next = {
      ...node,
      data,
      status: terminal.status,
      taskId: task?.id || node.taskId,
    } as T
    const write = prisma.canvasNode.updateMany({
      // updatedAt is the compare-and-swap guard: a concurrent regeneration can
      // keep the node RUNNING while changing its asset id, and must not be
      // overwritten with the older task's result.
      where: { id: node.id, canvasId, status: 'RUNNING', updatedAt: node.updatedAt },
      data: {
        data,
        status: terminal.status,
        ...(task?.id ? { taskId: task.id } : {}),
      },
    })
    candidates.push({ node, next, write })
  }

  if (candidates.length === 0) {
    return await reconcileCanvasTextGenerationNodes({ projectId, canvasId, nodes })
  }
  const results = await Promise.all(candidates.map((candidate) => candidate.write))
  const reconciled = new Map<string, T>()
  results.forEach((result, index) => {
    if (result.count === 1) reconciled.set(candidates[index].node.id, candidates[index].next)
  })
  const mediaReconciled = nodes.map((node) => reconciled.get(node.id) || node)
  return await reconcileCanvasTextGenerationNodes({ projectId, canvasId, nodes: mediaReconciled })
}

type CanvasGenerationTaskState = {
  id: string
  type: string
  targetId: string
  status: string
  progress: number
  payload: Prisma.JsonValue | null
  result: Prisma.JsonValue | null
  errorMessage: string | null
  billingInfo: unknown
  finishedAt: Date | null
}

function reconcileTextTaskHistory(
  value: unknown,
  task: CanvasGenerationTaskState,
  textValue: string | null,
  errorMessage: string | null,
  actualCostPoints: number | null,
) {
  const source = Array.isArray(value) ? value : []
  let matched = false
  const mapped = source.map((item) => {
    const entry = record(item)
    if (!entry || cleanText(entry.taskId) !== task.id) return item
    matched = true
    return textValue !== null
      ? { ...entry, text: textValue, status: 'ready', errorMessage: null, ...(actualCostPoints !== null ? { actualCostPoints } : {}) }
      : { ...entry, status: 'failed', errorMessage }
  })
  if (matched) return mapped
  const payload = parseCanvasGenerationTaskPayload(task.type, task.payload)
  return [{
    id: `task:${task.id}`,
    taskId: task.id,
    text: textValue,
    prompt: payload?.prompt || null,
    modelKey: payload?.kind === 'text' ? payload.modelKey : null,
    source: 'generation',
    status: textValue !== null ? 'ready' : 'failed',
    errorMessage,
    ...(textValue !== null && actualCostPoints !== null ? { actualCostPoints } : {}),
    createdAt: task.finishedAt?.toISOString() || new Date().toISOString(),
  }, ...mapped].slice(0, 40)
}

function terminalCanvasTextTaskProjection(
  node: ReconciliableCanvasNode,
  task: CanvasGenerationTaskState,
): { status: 'SUCCEEDED' | 'FAILED'; data: Prisma.InputJsonValue } | null {
  const payload = parseCanvasGenerationTaskPayload(task.type, task.payload)
  if (!payload || payload.canvasId === '' || payload.nodeId !== node.id) return null
  const current = record(node.data) || {}
  const currentGenerationTask = record(current.generationTask) || {}

  if (task.status === TASK_STATUS.COMPLETED && payload.kind === 'storyboard_plan') {
    // The planning result still needs to be materialized into image tasks by
    // the canvas client. Keep the node RUNNING so a refresh resumes that step.
    return null
  }

  if (task.status === TASK_STATUS.COMPLETED && payload.kind === 'text') {
    const result = record(task.result)
    const textValue = cleanText(result?.text)
    if (textValue) {
      return {
        status: 'SUCCEEDED',
        data: {
          ...current,
          text: textValue,
          origin: 'generate',
          progress: 100,
          errorMessage: null,
          generationTask: { ...currentGenerationTask, taskId: task.id, kind: payload.kind, completed: true },
          history: reconcileTextTaskHistory(current.history, task, textValue, null, completedTaskCostPoints(task)),
        } as Prisma.InputJsonValue,
      }
    }
  }

  const failed = task.status === TASK_STATUS.FAILED
    || task.status === TASK_STATUS.CANCELED
    || task.status === TASK_STATUS.DISMISSED
    || (task.status === TASK_STATUS.COMPLETED && payload.kind === 'text')
  if (!failed) return null
  const errorMessage = cleanText(task.errorMessage)
    || (task.status === TASK_STATUS.CANCELED ? '生成任务已取消' : '生成任务没有返回可用结果')
  return {
    status: 'FAILED',
    data: {
      ...current,
      progress: Math.max(0, Math.min(100, task.progress)),
      errorMessage,
      generationTask: { ...currentGenerationTask, taskId: task.id, kind: payload.kind, completed: true },
      ...(payload.kind === 'text'
        ? { history: reconcileTextTaskHistory(current.history, task, null, errorMessage, null) }
        : {}),
    } as Prisma.InputJsonValue,
  }
}

async function reconcileCanvasTextGenerationNodes<T extends ReconciliableCanvasNode>({
  projectId,
  canvasId,
  nodes,
}: {
  projectId: string
  canvasId: string
  nodes: T[]
}): Promise<T[]> {
  const taskIds = Array.from(new Set(nodes.map(generationTaskId).filter(Boolean)))
  if (taskIds.length === 0) return nodes
  const tasks = await prisma.task.findMany({
    where: {
      id: { in: taskIds },
      projectId,
      targetType: 'CanvasNode',
    },
    select: {
      id: true,
      type: true,
      targetId: true,
      status: true,
      progress: true,
      payload: true,
      result: true,
      errorMessage: true,
      billingInfo: true,
      finishedAt: true,
    },
  })
  const taskById = new Map(tasks
    .filter((task) => isCanvasGenerationTaskType(task.type))
    .map((task) => [task.id, task]))
  const candidates: Array<{
    node: T
    next: T
    write: ReturnType<typeof prisma.canvasNode.updateMany>
  }> = []
  for (const node of nodes) {
    const taskId = generationTaskId(node)
    const task = taskById.get(taskId)
    if (!task || task.targetId !== node.id) continue
    const payload = parseCanvasGenerationTaskPayload(task.type, task.payload)
    if (!payload || payload.canvasId !== canvasId || payload.nodeId !== node.id) continue
    const terminal = terminalCanvasTextTaskProjection(node, task)
    if (!terminal) continue
    const next = { ...node, status: terminal.status, taskId: task.id, data: terminal.data } as T
    candidates.push({
      node,
      next,
      write: prisma.canvasNode.updateMany({
        where: { id: node.id, canvasId, status: 'RUNNING', taskId: task.id, updatedAt: node.updatedAt },
        data: { status: terminal.status, taskId: task.id, data: terminal.data },
      }),
    })
  }
  if (candidates.length === 0) return nodes
  const writes = await Promise.all(candidates.map((candidate) => candidate.write))
  const reconciled = new Map<string, T>()
  writes.forEach((write, index) => {
    if (write.count === 1) reconciled.set(candidates[index].node.id, candidates[index].next)
  })
  return nodes.map((node) => reconciled.get(node.id) || node)
}
