import { NextRequest, NextResponse } from 'next/server'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError, getRequestId } from '@/lib/api-errors'
import { resolveWorkflowScope } from '@/lib/workflow/episode-scope'
import { retryStage } from '@/lib/workflow/run-stage'
import { WORKFLOW_STAGES, type WorkflowStage } from '@/lib/workflow/types'

function isValidStage(value: string): value is WorkflowStage {
  return WORKFLOW_STAGES.includes(value as WorkflowStage)
}

function toObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string; stage: string }> },
) => {
  const { projectId, stage } = await context.params
  if (!isValidStage(stage)) {
    throw new ApiError('INVALID_PARAMS', { message: `invalid stage: ${stage}` })
  }

  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const body = toObject(await request.json().catch(() => ({})))
  const { episodeId } = await resolveWorkflowScope({
    projectId,
    episodeId: body.episodeId,
  })
  const result = await retryStage({
    userId: authResult.session.user.id,
    projectId,
    stage,
    locale: (request.headers.get('x-locale') || 'zh') as any,
    episodeId,
    input: toObject(body.input),
    requestId: getRequestId(request),
  })

  return NextResponse.json({
    success: true,
    ...result,
  })
})
