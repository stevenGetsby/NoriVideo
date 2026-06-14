import { NextRequest, NextResponse } from 'next/server'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { resolveWorkflowScope } from '@/lib/workflow/episode-scope'
import { unapproveStage } from '@/lib/workflow/run-stage'
import { WORKFLOW_STAGES, type WorkflowStage } from '@/lib/workflow/types'

function isValidStage(value: string): value is WorkflowStage {
  return WORKFLOW_STAGES.includes(value as WorkflowStage)
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

  const body = await request.json().catch(() => ({})) as { episodeId?: string }
  const { episodeId } = await resolveWorkflowScope({
    projectId,
    episodeId: body.episodeId,
  })

  const result = await unapproveStage({
    userId: authResult.session.user.id,
    projectId,
    stage,
    episodeId,
  })

  return NextResponse.json(result)
})
