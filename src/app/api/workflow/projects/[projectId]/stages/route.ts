import { NextRequest, NextResponse } from 'next/server'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler } from '@/lib/api-errors'
import { resolveWorkflowScope } from '@/lib/workflow/episode-scope'
import { isStageLocked, isStageReadonly, loadStageStates } from '@/lib/workflow/stage-machine'
import { STAGE_LABELS, WORKFLOW_STAGES, type WorkflowStageStatus } from '@/lib/workflow/types'

function normalizeSummary(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function toIsoString(value: unknown): string | null {
  return value instanceof Date ? value.toISOString() : null
}

export const GET = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params

  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const { episodeId, scopeId } = await resolveWorkflowScope({
    projectId,
    episodeId: request.nextUrl.searchParams.get('episodeId'),
  })
  const stageStates = await loadStageStates(authResult.session.user.id, projectId, scopeId)

  const stages = WORKFLOW_STAGES.map((stage) => {
    const row = stageStates.get(stage)
    const status = (row?.status || 'idle') as WorkflowStageStatus
    return {
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
    }
  })

  const activeStage = stages.find((s) => s.status === 'running' || s.status === 'queued')?.stage
    || stages.find((s) => s.status === 'failed')?.stage
    || stages.find((s) => s.status === 'pending_review')?.stage
    || stages.find((s) => !s.locked && s.status === 'idle')?.stage
    || null

  return NextResponse.json({
    projectId,
    episodeId,
    scopeId,
    stages,
    activeStage,
  })
})
