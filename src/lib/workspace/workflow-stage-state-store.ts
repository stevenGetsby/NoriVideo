import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { removeTaskJob } from '@/lib/task/queues'
import { cancelTask } from '@/lib/task/service'
import { TASK_EVENT_TYPE, TASK_STATUS, TASK_TYPE, type SSEEvent, type TaskType } from '@/lib/task/types'
import { RUN_EVENT_TYPE, type RunEventInput } from '@/lib/run-runtime/types'

export type WorkflowStageRuntimeState = 'queued' | 'running' | 'completed' | 'failed' | 'canceled'
export type WorkflowStageKey = 'config' | 'script' | 'storyboard' | 'videos' | 'voice' | 'editor'

const PROJECT_SCOPE_ID = 'project'
const WORKFLOW_STAGE_ORDER: WorkflowStageKey[] = ['config', 'script', 'storyboard', 'videos', 'voice', 'editor']

const TASK_STAGE_MAP: Partial<Record<string, WorkflowStageKey>> = {
  [TASK_TYPE.STORY_TO_SCRIPT_RUN]: 'script',
  [TASK_TYPE.CLIPS_BUILD]: 'script',
  [TASK_TYPE.SCREENPLAY_CONVERT]: 'script',
  [TASK_TYPE.ANALYZE_NOVEL]: 'script',
  [TASK_TYPE.EPISODE_SPLIT_LLM]: 'script',
  [TASK_TYPE.IMAGE_CHARACTER]: 'script',
  [TASK_TYPE.IMAGE_LOCATION]: 'script',
  [TASK_TYPE.MODIFY_ASSET_IMAGE]: 'script',
  [TASK_TYPE.AI_CREATE_CHARACTER]: 'script',
  [TASK_TYPE.AI_CREATE_LOCATION]: 'script',
  [TASK_TYPE.AI_MODIFY_APPEARANCE]: 'script',
  [TASK_TYPE.AI_MODIFY_LOCATION]: 'script',
  [TASK_TYPE.AI_MODIFY_PROP]: 'script',
  [TASK_TYPE.REFERENCE_TO_CHARACTER]: 'script',
  [TASK_TYPE.CHARACTER_PROFILE_CONFIRM]: 'script',
  [TASK_TYPE.CHARACTER_PROFILE_BATCH_CONFIRM]: 'script',

  [TASK_TYPE.SCRIPT_TO_STORYBOARD_RUN]: 'storyboard',
  [TASK_TYPE.IMAGE_PANEL]: 'storyboard',
  [TASK_TYPE.REGENERATE_STORYBOARD_TEXT]: 'storyboard',
  [TASK_TYPE.INSERT_PANEL]: 'storyboard',
  [TASK_TYPE.PANEL_VARIANT]: 'storyboard',
  [TASK_TYPE.REGENERATE_GROUP]: 'storyboard',
  [TASK_TYPE.ANALYZE_SHOT_VARIANTS]: 'storyboard',

  [TASK_TYPE.VIDEO_PANEL]: 'videos',
  [TASK_TYPE.LIP_SYNC]: 'videos',

  [TASK_TYPE.VOICE_LINE]: 'voice',
  [TASK_TYPE.VOICE_DESIGN]: 'voice',
  [TASK_TYPE.VOICE_ANALYZE]: 'voice',

  [TASK_TYPE.EXPORT_DELIVERY]: 'editor',
}

function toObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseFloat(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function clampProgress(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.max(0, Math.min(100, Math.round(value)))
}

function resolveScopeId(episodeId?: string | null) {
  return episodeId || PROJECT_SCOPE_ID
}

function isActiveRuntimeState(value: string | null | undefined) {
  return value === 'queued' || value === 'running'
}

function isTerminalRuntimeState(value: string | null | undefined) {
  return (
    value === 'completed'
    || value === 'failed'
    || value === 'canceled'
    || value === 'pending_review'
    || value === 'approved'
    || value === 'stale'
  )
}

function isSameRuntimeExecution(params: {
  existingLastRunId?: string | null
  existingLastTaskId?: string | null
  nextLastRunId?: string | null
  nextLastTaskId?: string | null
}) {
  if (params.existingLastRunId && params.nextLastRunId) {
    return params.existingLastRunId === params.nextLastRunId
  }
  if (params.existingLastTaskId && params.nextLastTaskId) {
    return params.existingLastTaskId === params.nextLastTaskId
  }
  return false
}

export function shouldApplyWorkflowStageRuntimeUpdate(params: {
  existingStatus?: string | null
  existingLastRunId?: string | null
  existingLastTaskId?: string | null
  nextStatus: WorkflowStageRuntimeState
  nextLastRunId?: string | null
  nextLastTaskId?: string | null
}) {
  if (
    isTerminalRuntimeState(params.existingStatus)
    && isActiveRuntimeState(params.nextStatus)
    && isSameRuntimeExecution(params)
  ) {
    return false
  }
  return true
}

export function resolveNextWorkflowStageProgress(params: {
  existingProgress?: number | null
  nextProgress?: number | null
  sameExecution: boolean
}) {
  const next = clampProgress(params.nextProgress)
  if (next === null) return params.existingProgress ?? null
  if (!params.sameExecution) return next
  return Math.max(params.existingProgress ?? 0, next)
}

export function resolveWorkflowStageKeyFromTaskType(taskType: string | null | undefined): WorkflowStageKey | null {
  if (!taskType) return null
  return TASK_STAGE_MAP[taskType] || null
}

export function resolveDownstreamWorkflowStageKeys(stageKey: WorkflowStageKey): WorkflowStageKey[] {
  const index = WORKFLOW_STAGE_ORDER.indexOf(stageKey)
  if (index < 0) return []
  return WORKFLOW_STAGE_ORDER.slice(index + 1)
}

export function buildWorkflowStageInvalidationPlan(taskType: string | null | undefined) {
  const sourceStage = resolveWorkflowStageKeyFromTaskType(taskType)
  if (!sourceStage) return null

  const staleStages = resolveDownstreamWorkflowStageKeys(sourceStage)
  if (staleStages.length === 0) return null

  const staleStageSet = new Set(staleStages)
  const cancelTaskTypes = Object.entries(TASK_STAGE_MAP)
    .filter((entry): entry is [TaskType, WorkflowStageKey] => Boolean(entry[1] && staleStageSet.has(entry[1])))
    .map(([type]) => type)

  return {
    sourceStage,
    staleStages,
    cancelTaskTypes,
  }
}

export async function invalidateDownstreamWorkflowStagesForTask(params: {
  userId: string
  projectId: string
  episodeId?: string | null
  taskId: string
  taskType: TaskType
}) {
  const plan = buildWorkflowStageInvalidationPlan(params.taskType)
  if (!plan) {
    return {
      sourceStage: resolveWorkflowStageKeyFromTaskType(params.taskType),
      staleStages: [] as WorkflowStageKey[],
      cancelledTaskCount: 0,
      blockedExportQueueCount: 0,
    }
  }

  const scopeId = resolveScopeId(params.episodeId)
  const now = new Date()
  await Promise.all(plan.staleStages.map((stageKey) => prisma.workflowStageState.upsert({
    where: {
      userId_projectId_scopeId_stageKey: {
        userId: params.userId,
        projectId: params.projectId,
        scopeId,
        stageKey,
      },
    },
    create: {
      userId: params.userId,
      projectId: params.projectId,
      scopeId,
      stageKey,
      status: 'stale',
      reviewState: 'review',
      blocker: `upstream_${plan.sourceStage}_regenerating`,
      summary: {
        reason: 'upstream_task_submitted',
        sourceStage: plan.sourceStage,
        taskType: params.taskType,
        taskId: params.taskId,
      },
    },
    update: {
      status: 'stale',
      reviewState: 'review',
      approvedAt: null,
      approvedBy: null,
      blocker: `upstream_${plan.sourceStage}_regenerating`,
      summary: {
        reason: 'upstream_task_submitted',
        sourceStage: plan.sourceStage,
        taskType: params.taskType,
        taskId: params.taskId,
      },
      updatedAt: now,
    },
  })))

  const activeDownstreamTasks = plan.cancelTaskTypes.length > 0
    ? await prisma.task.findMany({
        where: {
          userId: params.userId,
          projectId: params.projectId,
          episodeId: params.episodeId || null,
          id: { not: params.taskId },
          type: { in: plan.cancelTaskTypes },
          status: { in: [TASK_STATUS.QUEUED, TASK_STATUS.PROCESSING] },
        },
        select: { id: true },
      })
    : []

  let cancelledTaskCount = 0
  for (const task of activeDownstreamTasks) {
    const result = await cancelTask(task.id, `Canceled because upstream ${plan.sourceStage} task was resubmitted`)
    if (result.cancelled) {
      cancelledTaskCount += 1
      await removeTaskJob(task.id).catch(() => false)
    }
  }

  const exportQueue = plan.staleStages.includes('editor')
    ? await prisma.exportQueueRecord.updateMany({
        where: {
          userId: params.userId,
          projectId: params.projectId,
          scopeId,
          status: { in: ['queued', 'ready'] },
        },
        data: {
          status: 'blocked',
          blocker: `upstream_${plan.sourceStage}_regenerating`,
          updatedAt: now,
        },
      })
    : { count: 0 }

  return {
    sourceStage: plan.sourceStage,
    staleStages: plan.staleStages,
    cancelledTaskCount,
    blockedExportQueueCount: exportQueue.count,
  }
}

function resolveTaskRuntimeState(event: SSEEvent): WorkflowStageRuntimeState | null {
  const lifecycleType = readString(event.payload?.lifecycleType)
  if (lifecycleType === TASK_EVENT_TYPE.CREATED) return 'queued'
  if (lifecycleType === TASK_EVENT_TYPE.PROCESSING || lifecycleType === TASK_EVENT_TYPE.PROGRESS) return 'running'
  if (lifecycleType === TASK_EVENT_TYPE.COMPLETED) return 'completed'
  if (lifecycleType === TASK_EVENT_TYPE.FAILED) return 'failed'
  return null
}

export function resolveRunRuntimeState(eventType: string): WorkflowStageRuntimeState | null {
  if (eventType === RUN_EVENT_TYPE.RUN_START || eventType === RUN_EVENT_TYPE.STEP_START || eventType === RUN_EVENT_TYPE.STEP_CHUNK) return 'running'
  if (eventType === RUN_EVENT_TYPE.STEP_COMPLETE) return 'running'
  if (eventType === RUN_EVENT_TYPE.RUN_COMPLETE) return 'completed'
  if (eventType === RUN_EVENT_TYPE.RUN_ERROR || eventType === RUN_EVENT_TYPE.STEP_ERROR) return 'failed'
  if (eventType === RUN_EVENT_TYPE.RUN_CANCELED) return 'canceled'
  return null
}

function resolvePayloadProgress(payload: Record<string, unknown>, state: WorkflowStageRuntimeState) {
  if (state === 'completed') return 100
  const explicit = clampProgress(readNumber(payload.progress))
  if (explicit !== null) return explicit

  const stageIndex = readNumber(payload.flowStageIndex)
  const stageTotal = readNumber(payload.flowStageTotal)
  if (stageIndex && stageTotal && stageTotal > 0) {
    return clampProgress((stageIndex / stageTotal) * 100)
  }

  if (state === 'queued') return 0
  return null
}

function resolveError(payload: Record<string, unknown>) {
  const error = toObject(payload.error)
  return {
    code: readString(payload.errorCode) || readString(error.code),
    message: readString(payload.errorMessage) || readString(payload.message) || readString(error.message),
  }
}

function buildSummary(params: {
  taskType?: string | null
  workflowType?: string | null
  targetType?: string | null
  targetId?: string | null
  stepKey?: string | null
  payload: Record<string, unknown>
}) {
  return {
    taskType: params.taskType || null,
    workflowType: params.workflowType || null,
    targetType: params.targetType || null,
    targetId: params.targetId || null,
    stepKey: params.stepKey || null,
    message: readString(params.payload.message),
    stage: readString(params.payload.stage),
    stageLabel: readString(params.payload.stageLabel),
    flowStageIndex: readNumber(params.payload.flowStageIndex),
    flowStageTotal: readNumber(params.payload.flowStageTotal),
    flowStageTitle: readString(params.payload.flowStageTitle),
  } satisfies Prisma.InputJsonObject
}

async function upsertWorkflowStageRuntimeState(params: {
  userId: string
  projectId: string
  episodeId?: string | null
  stageKey: WorkflowStageKey
  state: WorkflowStageRuntimeState
  progress?: number | null
  lastRunId?: string | null
  lastTaskId?: string | null
  summary?: Prisma.InputJsonValue | null
  errorCode?: string | null
  errorMessage?: string | null
}) {
  const scopeId = resolveScopeId(params.episodeId)
  const existing = await prisma.workflowStageState.findUnique({
    where: {
      userId_projectId_scopeId_stageKey: {
        userId: params.userId,
        projectId: params.projectId,
        scopeId,
        stageKey: params.stageKey,
      },
    },
    select: {
      status: true,
      progress: true,
      lastRunId: true,
      lastTaskId: true,
    },
  })
  if (!shouldApplyWorkflowStageRuntimeUpdate({
    existingStatus: existing?.status,
    existingLastRunId: existing?.lastRunId,
    existingLastTaskId: existing?.lastTaskId,
    nextStatus: params.state,
    nextLastRunId: params.lastRunId,
    nextLastTaskId: params.lastTaskId,
  })) {
    return
  }

  const sameExecution = isSameRuntimeExecution({
    existingLastRunId: existing?.lastRunId,
    existingLastTaskId: existing?.lastTaskId,
    nextLastRunId: params.lastRunId,
    nextLastTaskId: params.lastTaskId,
  })
  const progress = resolveNextWorkflowStageProgress({
    existingProgress: existing?.progress,
    nextProgress: params.progress,
    sameExecution,
  })
  const now = new Date()
  const persistedStatus = params.state === 'completed' ? 'pending_review' : params.state
  const errorData = params.state === 'failed'
    ? {
        errorCode: params.errorCode || 'TASK_FAILED',
        errorMessage: params.errorMessage || 'Task failed',
        blocker: params.errorMessage || 'Task failed',
      }
    : {
        errorCode: null,
        errorMessage: null,
        blocker: null,
      }

  await prisma.workflowStageState.upsert({
    where: {
      userId_projectId_scopeId_stageKey: {
        userId: params.userId,
        projectId: params.projectId,
        scopeId,
        stageKey: params.stageKey,
      },
    },
    create: {
      userId: params.userId,
      projectId: params.projectId,
      scopeId,
      stageKey: params.stageKey,
      status: persistedStatus,
      progress,
      lastRunId: params.lastRunId || null,
      lastTaskId: params.lastTaskId || null,
      summary: params.summary ?? undefined,
      ...errorData,
    },
    update: {
      status: persistedStatus,
      progress,
      lastRunId: params.lastRunId || undefined,
      lastTaskId: params.lastTaskId || undefined,
      summary: params.summary ?? undefined,
      updatedAt: now,
      ...errorData,
    },
  })
}

export async function recordWorkflowStageProgressFromTaskEvent(event: SSEEvent) {
  const stageKey = resolveWorkflowStageKeyFromTaskType(event.taskType)
  const state = resolveTaskRuntimeState(event)
  if (!stageKey || !state) return

  const payload = toObject(event.payload)
  const runId = readString(payload.runId) || readString(toObject(payload.meta).runId)
  const error = resolveError(payload)
  await upsertWorkflowStageRuntimeState({
    userId: event.userId,
    projectId: event.projectId,
    episodeId: event.episodeId || null,
    stageKey,
    state,
    progress: resolvePayloadProgress(payload, state),
    lastRunId: runId,
    lastTaskId: event.taskId,
    summary: buildSummary({
      taskType: event.taskType || null,
      targetType: event.targetType || null,
      targetId: event.targetId || null,
      payload,
    }),
    errorCode: error.code,
    errorMessage: error.message,
  })
}

export async function recordWorkflowStageProgressFromRunEvent(input: RunEventInput) {
  const state = resolveRunRuntimeState(input.eventType)
  if (!state) return

  const run = await prisma.graphRun.findUnique({
    where: { id: input.runId },
    select: {
      id: true,
      taskType: true,
      workflowType: true,
      taskId: true,
      targetType: true,
      targetId: true,
      episodeId: true,
    },
  })
  if (!run) return

  const stageKey = resolveWorkflowStageKeyFromTaskType(run.taskType || run.workflowType)
  if (!stageKey) return

  const payload = toObject(input.payload)
  const error = resolveError(payload)
  await upsertWorkflowStageRuntimeState({
    userId: input.userId,
    projectId: input.projectId,
    episodeId: run.episodeId,
    stageKey,
    state,
    progress: resolvePayloadProgress(payload, state),
    lastRunId: input.runId,
    lastTaskId: run.taskId || null,
    summary: buildSummary({
      taskType: run.taskType,
      workflowType: run.workflowType,
      targetType: run.targetType,
      targetId: run.targetId,
      stepKey: input.stepKey || null,
      payload,
    }),
    errorCode: error.code,
    errorMessage: error.message,
  })
}
