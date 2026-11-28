import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'
import { setAccountActorContext } from '@/lib/account/request-context'
import { getWorkspaceActor, isProjectHiddenFromActor } from '@/lib/collaboration/access'
import { resolveTaskLocale } from '@/lib/task/resolve-locale'
import { getBatchRunById } from '@/lib/batch-workflow/service'
import { advanceBatchRun } from '@/lib/batch-workflow/executor'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export const POST = apiHandler(async (
  request: NextRequest,
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
    throw new ApiError('FORBIDDEN', { message: '当前账号无权推进该工作流批次。' })
  }

  const rawText = await request.text().catch(() => '')
  let body: Record<string, unknown> = {}
  if (rawText.trim()) {
    let parsed: unknown
    try {
      parsed = JSON.parse(rawText)
    } catch {
      throw new ApiError('INVALID_PARAMS', { message: '请求体 JSON 格式无效。' })
    }
    if (!isPlainObject(parsed)) {
      throw new ApiError('INVALID_PARAMS', { message: '请求体必须为 JSON 对象。' })
    }
    body = parsed
  }

  let maxSteps: number | undefined
  if (body.maxSteps !== undefined) {
    if (typeof body.maxSteps !== 'number' || !Number.isFinite(body.maxSteps) || body.maxSteps < 1) {
      throw new ApiError('INVALID_PARAMS', { message: 'maxSteps 必须为大于 0 的整数。' })
    }
    maxSteps = Math.min(200, Math.floor(body.maxSteps))
  }

  let itemIds: string[] | undefined
  if (body.itemIds !== undefined) {
    if (!Array.isArray(body.itemIds) || body.itemIds.some((id) => typeof id !== 'string' || !id.trim())) {
      throw new ApiError('INVALID_PARAMS', { message: 'itemIds 必须为非空字符串数组。' })
    }
    itemIds = body.itemIds.map((id) => (id as string).trim())
  }

  if (body.approveWaitingReview !== undefined && typeof body.approveWaitingReview !== 'boolean') {
    throw new ApiError('INVALID_PARAMS', { message: 'approveWaitingReview 必须为布尔值。' })
  }

  const locale = resolveTaskLocale(request, body) ?? 'zh'
  const result = await advanceBatchRun({
    workspaceOwnerId: actor.workspaceOwnerId,
    actorId: actor.actorId,
    batchRunId: trimmedId,
    ...(maxSteps !== undefined ? { maxSteps } : {}),
    ...(itemIds !== undefined ? { itemIds } : {}),
    ...(typeof body.approveWaitingReview === 'boolean' ? { approveWaitingReview: body.approveWaitingReview } : {}),
    locale,
  })

  return NextResponse.json({
    result,
    run: result.run,
    hasPendingAsyncTasks: result.hasPendingAsyncTasks,
    executedSteps: result.executedSteps,
  })
})
