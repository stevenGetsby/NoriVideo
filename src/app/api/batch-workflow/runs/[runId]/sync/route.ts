import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'
import { setAccountActorContext } from '@/lib/account/request-context'
import { getWorkspaceActor, isProjectHiddenFromActor } from '@/lib/collaboration/access'
import { getBatchRunById } from '@/lib/batch-workflow/service'
import { syncBatchItemTaskStatuses } from '@/lib/batch-workflow/executor'

export const POST = apiHandler(async (
  _request: NextRequest,
  context: { params: Promise<{ runId: string }> },
) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const actor = getWorkspaceActor(authResult.session)
  setAccountActorContext(actor.actorId, actor.workspaceOwnerId)
  const { runId } = await context.params

  const trimmedId = runId?.trim()
  if (!trimmedId) {
    throw new ApiError('INVALID_PARAMS', { message: '缺少 runId 参数。' })
  }

  const existing = await getBatchRunById({
    workspaceOwnerId: actor.workspaceOwnerId,
    runId: trimmedId,
    includeItems: false,
  })
  if (!existing) {
    throw new ApiError('NOT_FOUND', { message: '工作流批次不存在或无权操作。' })
  }
  if (await isProjectHiddenFromActor(actor, existing.projectId)) {
    throw new ApiError('FORBIDDEN', { message: '当前账号无权同步该工作流批次。' })
  }

  await syncBatchItemTaskStatuses({
    workspaceOwnerId: actor.workspaceOwnerId,
    batchRunId: trimmedId,
  })
  const run = await getBatchRunById({
    workspaceOwnerId: actor.workspaceOwnerId,
    runId: trimmedId,
    includeItems: true,
  })
  if (!run) {
    throw new ApiError('NOT_FOUND', { message: '工作流批次不存在或无权访问。' })
  }

  return NextResponse.json({ run })
})
