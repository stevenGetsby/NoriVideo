import { prisma } from '@/lib/prisma'
import { submitTask } from '@/lib/task/submitter'
import { TASK_TYPE, type TaskType } from '@/lib/task/types'
import { type WorkflowStage } from './types'
import { checkRunPreconditions, isStageActive } from './stage-machine'
import { ApiError } from '@/lib/api-errors'
import type { Locale } from '@/i18n/routing'

const STAGE_TASK_TYPE: Record<WorkflowStage, TaskType> = {
  config: TASK_TYPE.STORY_TO_SCRIPT_RUN,
  script: TASK_TYPE.ANALYZE_NOVEL,
  storyboard: TASK_TYPE.SCRIPT_TO_STORYBOARD_RUN,
  videos: TASK_TYPE.VIDEO_PANEL,
  voice: TASK_TYPE.VOICE_LINE,
  editor: TASK_TYPE.EXPORT_DELIVERY,
}

function resolveStageTaskType(stage: WorkflowStage, episodeId?: string | null): TaskType {
  if (stage === 'script' && !episodeId) {
    return TASK_TYPE.ANALYZE_GLOBAL
  }
  return STAGE_TASK_TYPE[stage]
}

function resolveStageTaskTarget(params: {
  stage: WorkflowStage
  taskType: TaskType
  episodeId?: string | null
  projectId: string
}) {
  if (
    params.taskType === TASK_TYPE.STORY_TO_SCRIPT_RUN
    || params.taskType === TASK_TYPE.SCRIPT_TO_STORYBOARD_RUN
  ) {
    if (!params.episodeId) {
      throw new ApiError('INVALID_PARAMS', {
        message: `episode_required_for_stage:${params.stage}`,
      })
    }
    return {
      targetType: 'NovelPromotionEpisode',
      targetId: params.episodeId,
    }
  }

  return {
    targetType: 'NovelPromotionProject',
    targetId: params.projectId,
  }
}

export async function runStage(params: {
  userId: string
  projectId: string
  stage: WorkflowStage
  locale: Locale
  episodeId?: string | null
  input?: Record<string, unknown> | null
  force?: boolean
  requestId?: string | null
}) {
  const { userId, projectId, stage, locale } = params
  const scopeId = params.episodeId || 'project'

  if (!params.force) {
    const check = await checkRunPreconditions({ userId, projectId, stage, scopeId })
    if (!check.allowed) {
      throw new ApiError('INVALID_PARAMS', {
        message: check.reason,
        blockers: check.blockers,
      })
    }
  }

  const existingActive = await prisma.workflowStageState.findFirst({
    where: {
      userId,
      projectId,
      scopeId,
      stageKey: stage,
      status: { in: ['queued', 'running'] },
    },
    select: { lastTaskId: true, lastRunId: true },
  })

  if (existingActive?.lastTaskId) {
    return {
      stage,
      status: 'already_active' as const,
      taskId: existingActive.lastTaskId,
      runId: existingActive.lastRunId,
      deduped: true,
    }
  }

  const taskType = resolveStageTaskType(stage, params.episodeId || null)
  const npProject = await prisma.novelPromotionProject.findUnique({
    where: { projectId },
    select: { id: true },
  })
  if (!npProject) {
    throw new ApiError('NOT_FOUND', { message: 'novel_promotion_project_not_found' })
  }

  const payload: Record<string, unknown> = {
    ...(params.input || {}),
    workflowStage: stage,
    episodeId: params.episodeId || null,
    flowId: `workflow_${stage}`,
    flowStageTitle: stage,
    meta: {
      workflowStage: stage,
      episodeId: params.episodeId || null,
      locale,
    },
  }
  const target = resolveStageTaskTarget({
    stage,
    taskType,
    episodeId: params.episodeId || null,
    projectId,
  })

  const result = await submitTask({
    userId,
    locale,
    projectId,
    episodeId: params.episodeId || null,
    type: taskType,
    targetType: target.targetType,
    targetId: target.targetId,
    payload,
    requestId: params.requestId || null,
  })

  await prisma.workflowStageState.upsert({
    where: {
      userId_projectId_scopeId_stageKey: { userId, projectId, scopeId, stageKey: stage },
    },
    create: {
      userId,
      projectId,
      scopeId,
      stageKey: stage,
      status: 'queued',
      progress: 0,
      lastTaskId: result.taskId,
      lastRunId: result.runId || null,
      blocker: null,
      errorCode: null,
      errorMessage: null,
    },
    update: {
      status: 'queued',
      progress: 0,
      lastTaskId: result.taskId,
      lastRunId: result.runId || null,
      blocker: null,
      errorCode: null,
      errorMessage: null,
      updatedAt: new Date(),
    },
  })

  return {
    stage,
    status: 'queued' as const,
    taskId: result.taskId,
    runId: result.runId || null,
    deduped: result.deduped || false,
  }
}

export async function retryStage(params: {
  userId: string
  projectId: string
  stage: WorkflowStage
  locale: Locale
  episodeId?: string | null
  input?: Record<string, unknown> | null
  requestId?: string | null
}) {
  const scopeId = params.episodeId || 'project'
  const row = await prisma.workflowStageState.findUnique({
    where: {
      userId_projectId_scopeId_stageKey: {
        userId: params.userId,
        projectId: params.projectId,
        scopeId,
        stageKey: params.stage,
      },
    },
    select: {
      status: true,
      lastTaskId: true,
      lastRunId: true,
      errorCode: true,
      errorMessage: true,
    },
  })
  const currentStatus = row?.status || 'idle'
  if (currentStatus !== 'failed' && currentStatus !== 'canceled' && currentStatus !== 'stale') {
    throw new ApiError('INVALID_PARAMS', {
      message: 'stage_not_retryable',
      currentStatus,
    })
  }

  const result = await runStage({
    userId: params.userId,
    projectId: params.projectId,
    stage: params.stage,
    locale: params.locale,
    episodeId: params.episodeId || null,
    input: {
      ...(params.input || {}),
      retryOfTaskId: row?.lastTaskId || null,
      retryOfRunId: row?.lastRunId || null,
      retryErrorCode: row?.errorCode || null,
      retryErrorMessage: row?.errorMessage || null,
    },
    requestId: params.requestId || null,
  })

  return {
    ...result,
    retried: true as const,
    previousStatus: currentStatus,
    previousTaskId: row?.lastTaskId || null,
    previousRunId: row?.lastRunId || null,
  }
}

export async function approveStage(params: {
  userId: string
  projectId: string
  stage: WorkflowStage
  episodeId?: string | null
}) {
  const { userId, projectId, stage } = params
  const scopeId = params.episodeId || 'project'

  const row = await prisma.workflowStageState.findUnique({
    where: {
      userId_projectId_scopeId_stageKey: { userId, projectId, scopeId, stageKey: stage },
    },
    select: { status: true, reviewState: true },
  })

  const status = row?.status || 'idle'
  if (status !== 'pending_review' && status !== 'stale' && status !== 'completed') {
    throw new ApiError('INVALID_PARAMS', { message: 'stage_not_approvable', currentStatus: status })
  }

  const now = new Date()
  await prisma.workflowStageState.upsert({
    where: {
      userId_projectId_scopeId_stageKey: { userId, projectId, scopeId, stageKey: stage },
    },
    create: {
      userId,
      projectId,
      scopeId,
      stageKey: stage,
      status: 'approved',
      reviewState: 'confirmed',
      approvedAt: now,
      approvedBy: userId,
    },
    update: {
      status: 'approved',
      reviewState: 'confirmed',
      approvedAt: now,
      approvedBy: userId,
      blocker: null,
      updatedAt: now,
    },
  })

  return { stage, status: 'approved' as const }
}

export async function unapproveStage(params: {
  userId: string
  projectId: string
  stage: WorkflowStage
  episodeId?: string | null
}) {
  const { userId, projectId, stage } = params
  const scopeId = params.episodeId || 'project'

  const row = await prisma.workflowStageState.findUnique({
    where: {
      userId_projectId_scopeId_stageKey: { userId, projectId, scopeId, stageKey: stage },
    },
    select: { status: true },
  })

  if (row?.status !== 'approved') {
    throw new ApiError('INVALID_PARAMS', { message: 'stage_not_approved', currentStatus: row?.status || 'idle' })
  }

  const now = new Date()
  await prisma.workflowStageState.update({
    where: {
      userId_projectId_scopeId_stageKey: { userId, projectId, scopeId, stageKey: stage },
    },
    data: {
      status: 'pending_review',
      reviewState: 'review',
      approvedAt: null,
      approvedBy: null,
      updatedAt: now,
    },
  })

  const { WORKFLOW_STAGES } = await import('./types')
  const stageIdx = WORKFLOW_STAGES.indexOf(stage)
  const downstreamStages = WORKFLOW_STAGES.slice(stageIdx + 1)

  if (downstreamStages.length > 0) {
    await prisma.workflowStageState.updateMany({
      where: {
        userId,
        projectId,
        scopeId,
        stageKey: { in: downstreamStages },
        status: { in: ['approved', 'pending_review'] },
      },
      data: {
        status: 'stale',
        reviewState: 'review',
        blocker: `upstream_${stage}_unapproved`,
        updatedAt: now,
      },
    })
  }

  return { stage, status: 'pending_review' as const, staleStages: downstreamStages }
}

export async function cancelStage(params: {
  userId: string
  projectId: string
  stage: WorkflowStage
  episodeId?: string | null
}) {
  const { userId, projectId, stage } = params
  const scopeId = params.episodeId || 'project'

  const row = await prisma.workflowStageState.findUnique({
    where: {
      userId_projectId_scopeId_stageKey: { userId, projectId, scopeId, stageKey: stage },
    },
    select: { status: true, lastTaskId: true, lastRunId: true },
  })

  if (!row || !isStageActive(row.status as any)) {
    throw new ApiError('INVALID_PARAMS', { message: 'stage_not_active', currentStatus: row?.status || 'idle' })
  }

  const now = new Date()
  await prisma.workflowStageState.update({
    where: {
      userId_projectId_scopeId_stageKey: { userId, projectId, scopeId, stageKey: stage },
    },
    data: {
      status: 'canceled',
      blocker: null,
      updatedAt: now,
    },
  })

  if (row.lastTaskId) {
    const { cancelTask } = await import('@/lib/task/service')
    await cancelTask(row.lastTaskId, 'User canceled workflow stage').catch(() => {})
  }

  return { stage, status: 'canceled' as const }
}
