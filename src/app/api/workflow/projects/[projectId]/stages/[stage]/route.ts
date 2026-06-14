import { NextRequest, NextResponse } from 'next/server'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { resolveWorkflowScope } from '@/lib/workflow/episode-scope'
import { isStageLocked, isStageReadonly, loadStageStates } from '@/lib/workflow/stage-machine'
import {
  STAGE_LABELS,
  WORKFLOW_STAGES,
  type WorkflowStage,
  type WorkflowStageStatus,
} from '@/lib/workflow/types'

function isValidStage(value: string): value is WorkflowStage {
  return WORKFLOW_STAGES.includes(value as WorkflowStage)
}

function normalizeSummary(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function toIsoString(value: unknown): string | null {
  return value instanceof Date ? value.toISOString() : null
}

export const GET = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string; stage: string }> },
) => {
  const { projectId, stage } = await context.params
  if (!isValidStage(stage)) {
    throw new ApiError('INVALID_PARAMS', { message: `invalid stage: ${stage}` })
  }

  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const { episodeId, scopeId } = await resolveWorkflowScope({
    projectId,
    episodeId: request.nextUrl.searchParams.get('episodeId'),
  })
  const stageStates = await loadStageStates(authResult.session.user.id, projectId, scopeId)
  const row = stageStates.get(stage)
  const status = (row?.status || 'idle') as WorkflowStageStatus

  return NextResponse.json({
    projectId,
    episodeId,
    scopeId,
    stage: {
      stage,
      label: STAGE_LABELS[stage],
      status,
      locked: isStageLocked(stage, stageStates),
      readonly: isStageReadonly(status),
      stale: status === 'stale',
      reviewState: row?.reviewState || null,
      progress: row?.progress ?? null,
      blocker: row?.blocker || null,
      lastRunId: row?.lastRunId || null,
      lastTaskId: row?.lastTaskId || null,
      errorCode: row?.errorCode || null,
      errorMessage: row?.errorMessage || null,
      summary: normalizeSummary(row?.summary),
      updatedAt: toIsoString(row?.updatedAt),
    },
  })
})
