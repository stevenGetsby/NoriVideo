import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'
import { getWorkspaceActor, isProjectHiddenFromActor } from '@/lib/collaboration/access'
import { getBatchRunById } from '@/lib/batch-workflow/service'
import { reviewBatchItemStage } from '@/lib/batch-workflow/executor'
import { isWorkflowStage } from '@/lib/batch-workflow/types'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ runId: string; itemId: string }> },
) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const actor = getWorkspaceActor(authResult.session)
  const { runId, itemId } = await context.params

  const trimmedRunId = runId?.trim()
  const trimmedItemId = itemId?.trim()
  if (!trimmedRunId || !trimmedItemId) {
    throw new ApiError('INVALID_PARAMS', { message: '缺少 runId 或 itemId 参数。' })
  }

  const existing = await getBatchRunById({
    workspaceOwnerId: actor.workspaceOwnerId,
    runId: trimmedRunId,
    includeItems: false,
  })
  if (!existing) {
    throw new ApiError('NOT_FOUND', { message: '工作流批次不存在或无权操作。' })
  }
  if (await isProjectHiddenFromActor(actor, existing.projectId)) {
    throw new ApiError('FORBIDDEN', { message: '当前账号无权审核该工作流条目。' })
  }

  const body = await request.json().catch(() => null)
  if (!isPlainObject(body)) {
    throw new ApiError('INVALID_PARAMS', { message: '请求体必须为有效的 JSON 对象。' })
  }

  if (!isWorkflowStage(body.stage)) {
    throw new ApiError('INVALID_PARAMS', {
      message: '请指定有效的审核阶段（stage：script_analysis / script_rewrite / asset_extraction / storyboard / video_gen）。',
    })
  }
  if (body.action !== 'approve' && body.action !== 'reject' && body.action !== 'save_draft') {
    throw new ApiError('INVALID_PARAMS', { message: '审核操作 action 必须为 approve、reject 或 save_draft。' })
  }
  if (body.editedOutput !== undefined && body.editedOutput !== null && !isPlainObject(body.editedOutput)) {
    throw new ApiError('INVALID_PARAMS', { message: 'editedOutput 必须为 JSON 对象或 null。' })
  }
  if (body.reviewNote !== undefined && body.reviewNote !== null && typeof body.reviewNote !== 'string') {
    throw new ApiError('INVALID_PARAMS', { message: 'reviewNote 必须为字符串或 null。' })
  }
  if (body.clearStale !== undefined && typeof body.clearStale !== 'boolean') {
    throw new ApiError('INVALID_PARAMS', { message: 'clearStale 必须为布尔值。' })
  }
  if (
    body.expectedRevision !== undefined
    && (typeof body.expectedRevision !== 'number'
      || !Number.isInteger(body.expectedRevision)
      || body.expectedRevision < 0)
  ) {
    throw new ApiError('INVALID_PARAMS', { message: 'expectedRevision 必须为非负整数。' })
  }

  const result = await reviewBatchItemStage({
    workspaceOwnerId: actor.workspaceOwnerId,
    batchRunId: trimmedRunId,
    itemId: trimmedItemId,
    stage: body.stage,
    action: body.action,
    editedOutput: (body.editedOutput as Record<string, unknown> | null | undefined) ?? null,
    reviewNote: typeof body.reviewNote === 'string' ? body.reviewNote.trim() : null,
    ...(typeof body.clearStale === 'boolean' ? { clearStale: body.clearStale } : {}),
    ...(typeof body.expectedRevision === 'number' ? { expectedRevision: body.expectedRevision } : {}),
  })

  return NextResponse.json({
    run: result.run,
    item: result.item,
  })
})
