import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'
import { setAccountActorContext } from '@/lib/account/request-context'
import { getWorkspaceActor, isProjectHiddenFromActor } from '@/lib/collaboration/access'
import { resolveTaskLocale } from '@/lib/task/resolve-locale'
import { getBatchRunById } from '@/lib/batch-workflow/service'
import {
  generateBatchItemVideos,
  selectShotTake,
} from '@/lib/batch-workflow/executor'

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
  setAccountActorContext(actor.actorId, actor.workspaceOwnerId)
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
    throw new ApiError('FORBIDDEN', { message: '当前账号无权操作该工作流的视频生成。' })
  }

  const body = await request.json().catch(() => null)
  if (!isPlainObject(body)) {
    throw new ApiError('INVALID_PARAMS', { message: '请求体必须为有效的 JSON 对象。' })
  }

  if (body.action === 'generate') {
    let shotIds: string[] | undefined
    if (body.shotIds !== undefined) {
      if (!Array.isArray(body.shotIds) || body.shotIds.some((id) => typeof id !== 'string' || !id.trim())) {
        throw new ApiError('INVALID_PARAMS', { message: 'shotIds 必须为非空字符串数组。' })
      }
      shotIds = body.shotIds.map((id) => (id as string).trim())
    }
    if (body.forceRerun !== undefined && typeof body.forceRerun !== 'boolean') {
      throw new ApiError('INVALID_PARAMS', { message: 'forceRerun 必须为布尔值。' })
    }
    if (body.regenerateAll !== undefined && typeof body.regenerateAll !== 'boolean') {
      throw new ApiError('INVALID_PARAMS', { message: 'regenerateAll 必须为布尔值。' })
    }
    if (body.expectedRevision !== undefined && (typeof body.expectedRevision !== 'number' || !Number.isInteger(body.expectedRevision) || body.expectedRevision < 0)) {
      throw new ApiError('INVALID_PARAMS', { message: 'expectedRevision 必须为非负整数。' })
    }
    if (body.shotOverrides !== undefined && !isPlainObject(body.shotOverrides)) {
      throw new ApiError('INVALID_PARAMS', { message: 'shotOverrides 必须为以 shotId 为键的对象。' })
    }

    const locale = resolveTaskLocale(request, body) ?? 'zh'
    const result = await generateBatchItemVideos({
      workspaceOwnerId: actor.workspaceOwnerId,
      actorId: actor.actorId,
      batchRunId: trimmedRunId,
      itemId: trimmedItemId,
      ...(shotIds !== undefined ? { shotIds } : {}),
      ...(body.regenerateAll !== undefined ? { regenerateAll: body.regenerateAll as boolean } : {}),
      ...(isPlainObject(body.shotOverrides) ? { shotOverrides: body.shotOverrides as Record<string, { durationSeconds?: number; prompt?: string; inputMode?: 'text' | 'image' | 'firstlastframe' }> } : {}),
      ...(typeof body.expectedRevision === 'number' ? { expectedRevision: body.expectedRevision } : {}),
      forceRerun: body.forceRerun === true,
      locale,
    })

    return NextResponse.json({
      run: result.run,
      item: result.item,
      stage: result.stage,
      outcome: result.outcome,
      stageOutcome: result.outcome,
    })
  }

  if (body.action === 'select_take') {
    const shotId = typeof body.shotId === 'string' ? body.shotId.trim() : ''
    if (!shotId) {
      throw new ApiError('INVALID_PARAMS', { message: '缺少目标镜头标识（shotId）。' })
    }
    if (typeof body.takeIndex !== 'number' || !Number.isInteger(body.takeIndex) || body.takeIndex < 0) {
      throw new ApiError('INVALID_PARAMS', { message: 'takeIndex 必须为非负整数。' })
    }

    const result = await selectShotTake({
      workspaceOwnerId: actor.workspaceOwnerId,
      batchRunId: trimmedRunId,
      itemId: trimmedItemId,
      shotId,
      takeIndex: body.takeIndex,
      ...(typeof body.expectedRevision === 'number' ? { expectedRevision: body.expectedRevision } : {}),
    })

    return NextResponse.json({
      run: result.run,
      item: result.item,
    })
  }

  throw new ApiError('INVALID_PARAMS', { message: 'action 必须为 generate 或 select_take。' })
})
