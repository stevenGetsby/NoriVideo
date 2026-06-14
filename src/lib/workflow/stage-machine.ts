import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { type WorkflowStage, type WorkflowStageStatus, WORKFLOW_STAGES } from './types'

const STAGE_PREREQUISITES: Record<WorkflowStage, WorkflowStage[]> = {
  config: [],
  script: ['config'],
  storyboard: ['script'],
  videos: ['storyboard'],
  voice: ['config'],
  editor: ['videos'],
}

const ACTIVE_STATUSES: Set<WorkflowStageStatus> = new Set(['queued', 'running'])
const APPROVABLE_STATUSES: Set<WorkflowStageStatus> = new Set(['pending_review', 'stale'])
const RUNNABLE_STATUSES: Set<WorkflowStageStatus> = new Set(['idle', 'failed', 'pending_review', 'approved', 'canceled', 'stale'])

type StageRow = {
  stageKey: string
  status: string
  reviewState: string | null
  progress: number | null
  blocker: string | null
  lastRunId: string | null
  lastTaskId: string | null
  summary: Prisma.JsonValue | null
  errorCode: string | null
  errorMessage: string | null
  updatedAt: Date
}

export function getPrerequisites(stage: WorkflowStage): WorkflowStage[] {
  return STAGE_PREREQUISITES[stage] || []
}

export function getDownstreamStages(stage: WorkflowStage): WorkflowStage[] {
  const idx = WORKFLOW_STAGES.indexOf(stage)
  if (idx < 0) return []
  return WORKFLOW_STAGES.filter((s) => {
    const prereqs = STAGE_PREREQUISITES[s]
    return prereqs.includes(stage) || WORKFLOW_STAGES.indexOf(s) > idx
  }).filter((s) => s !== stage)
}

export function isStageActive(status: WorkflowStageStatus): boolean {
  return ACTIVE_STATUSES.has(status)
}

export function canRunStage(stageStatus: WorkflowStageStatus): boolean {
  return RUNNABLE_STATUSES.has(stageStatus)
}

export function canApproveStage(stageStatus: WorkflowStageStatus): boolean {
  return APPROVABLE_STATUSES.has(stageStatus)
}

export function canUnapproveStage(stageStatus: WorkflowStageStatus): boolean {
  return stageStatus === 'approved'
}

export function canCancelStage(stageStatus: WorkflowStageStatus): boolean {
  return ACTIVE_STATUSES.has(stageStatus)
}

export function arePreconditionsMet(
  stage: WorkflowStage,
  stageStates: Map<string, StageRow>,
): { met: boolean; blockers: WorkflowStage[] } {
  const prereqs = STAGE_PREREQUISITES[stage]
  const blockers: WorkflowStage[] = []

  for (const prereq of prereqs) {
    const row = stageStates.get(prereq)
    const reviewState = row?.reviewState
    const status = row?.status as WorkflowStageStatus | undefined
    const isApproved =
      reviewState === 'confirmed' ||
      status === 'approved' ||
      status === 'pending_review'
    if (!isApproved) {
      blockers.push(prereq)
    }
  }

  return { met: blockers.length === 0, blockers }
}

export function isStageReadonly(status: WorkflowStageStatus): boolean {
  return status === 'approved' || isStageActive(status)
}

export function isStageLocked(
  stage: WorkflowStage,
  stageStates: Map<string, StageRow>,
): boolean {
  const { met } = arePreconditionsMet(stage, stageStates)
  return !met
}

export async function loadStageStates(
  userId: string,
  projectId: string,
  scopeId = 'project',
): Promise<Map<string, StageRow>> {
  const rows = await prisma.workflowStageState.findMany({
    where: { userId, projectId, scopeId },
    select: {
      stageKey: true,
      status: true,
      reviewState: true,
      progress: true,
      blocker: true,
      lastRunId: true,
      lastTaskId: true,
      summary: true,
      errorCode: true,
      errorMessage: true,
      updatedAt: true,
    },
  })
  const map = new Map<string, StageRow>()
  for (const row of rows) {
    map.set(row.stageKey, row)
  }
  return map
}

export async function checkRunPreconditions(params: {
  userId: string
  projectId: string
  stage: WorkflowStage
  scopeId?: string
}): Promise<{ allowed: boolean; reason?: string; blockers?: WorkflowStage[] }> {
  const stageStates = await loadStageStates(params.userId, params.projectId, params.scopeId || 'project')
  const currentRow = stageStates.get(params.stage)
  const currentStatus = (currentRow?.status || 'idle') as WorkflowStageStatus

  if (isStageActive(currentStatus)) {
    return { allowed: false, reason: 'stage_already_active' }
  }
  if (!canRunStage(currentStatus)) {
    return { allowed: false, reason: 'stage_status_not_runnable' }
  }

  const { met, blockers } = arePreconditionsMet(params.stage, stageStates)
  if (!met) {
    return { allowed: false, reason: 'prerequisites_not_met', blockers }
  }

  return { allowed: true }
}

export async function checkApprovePreconditions(params: {
  userId: string
  projectId: string
  stage: WorkflowStage
  scopeId?: string
}): Promise<{ allowed: boolean; reason?: string }> {
  const stageStates = await loadStageStates(params.userId, params.projectId, params.scopeId || 'project')
  const currentRow = stageStates.get(params.stage)
  const currentStatus = (currentRow?.status || 'idle') as WorkflowStageStatus

  if (!canApproveStage(currentStatus)) {
    return { allowed: false, reason: 'stage_not_approvable' }
  }

  return { allowed: true }
}

export async function checkUnapprovePreconditions(params: {
  userId: string
  projectId: string
  stage: WorkflowStage
  scopeId?: string
}): Promise<{ allowed: boolean; reason?: string }> {
  const stageStates = await loadStageStates(params.userId, params.projectId, params.scopeId || 'project')
  const currentRow = stageStates.get(params.stage)
  const currentStatus = (currentRow?.status || 'idle') as WorkflowStageStatus

  if (!canUnapproveStage(currentStatus)) {
    return { allowed: false, reason: 'stage_not_unapproved' }
  }

  return { allowed: true }
}
