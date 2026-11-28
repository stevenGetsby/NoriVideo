import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'
import { setAccountActorContext } from '@/lib/account/request-context'
import { getWorkspaceActor, isProjectHiddenFromActor } from '@/lib/collaboration/access'
import { resolveTaskLocale } from '@/lib/task/resolve-locale'
import { getBatchRunById } from '@/lib/batch-workflow/service'
import { runBatchItemStage } from '@/lib/batch-workflow/executor'
import { isWorkflowStage, type StageParams } from '@/lib/batch-workflow/types'

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
    throw new ApiError('FORBIDDEN', { message: '当前账号无权执行该工作流环节。' })
  }

  const body = await request.json().catch(() => null)
  if (!isPlainObject(body)) {
    throw new ApiError('INVALID_PARAMS', { message: '请求体必须为有效的 JSON 对象。' })
  }

  if (!isWorkflowStage(body.stage)) {
    throw new ApiError('INVALID_PARAMS', {
      message: '请指定有效的执行阶段（stage：script_analysis / script_rewrite / asset_extraction / storyboard / video_gen）。',
    })
  }
  if (body.skillIdOverride !== undefined && body.skillIdOverride !== null && typeof body.skillIdOverride !== 'string') {
    throw new ApiError('INVALID_PARAMS', { message: 'skillIdOverride 必须为字符串或 null。' })
  }
  if (body.skillSlugOverride !== undefined && body.skillSlugOverride !== null && typeof body.skillSlugOverride !== 'string') {
    throw new ApiError('INVALID_PARAMS', { message: 'skillSlugOverride 必须为字符串或 null。' })
  }
  if (body.stageParamsOverride !== undefined && body.stageParamsOverride !== null && !isPlainObject(body.stageParamsOverride)) {
    throw new ApiError('INVALID_PARAMS', { message: 'stageParamsOverride 必须为对象或 null。' })
  }
  if (body.forceRerun !== undefined && typeof body.forceRerun !== 'boolean') {
    throw new ApiError('INVALID_PARAMS', { message: 'forceRerun 必须为布尔值。' })
  }
  if (
    body.expectedRevision !== undefined
    && (typeof body.expectedRevision !== 'number'
      || !Number.isInteger(body.expectedRevision)
      || body.expectedRevision < 0)
  ) {
    throw new ApiError('INVALID_PARAMS', { message: 'expectedRevision 必须为非负整数。' })
  }

  let shotIds: string[] | undefined
  if (body.shotIds !== undefined) {
    if (!Array.isArray(body.shotIds) || body.shotIds.some((id) => typeof id !== 'string' || !id.trim())) {
      throw new ApiError('INVALID_PARAMS', { message: 'shotIds 必须为非空字符串数组。' })
    }
    shotIds = body.shotIds.map((id) => (id as string).trim())
  }

  for (const field of [
    'pastedScript',
    'sourceVideoMaterialId',
    'sourceVideoStorageKey',
    'sourceVideoUrl',
    'sourceVideoFileName',
  ] as const) {
    if (body[field] !== undefined && body[field] !== null && typeof body[field] !== 'string') {
      throw new ApiError('INVALID_PARAMS', { message: `${field} 必须为字符串或 null。` })
    }
  }

  const skillIdOverride = typeof body.skillIdOverride === 'string'
    ? body.skillIdOverride.trim() || null
    : null
  const skillSlugOverride = typeof body.skillSlugOverride === 'string'
    ? body.skillSlugOverride.trim() || null
    : null
  const locale = resolveTaskLocale(request, body) ?? 'zh'

  const result = await runBatchItemStage({
    workspaceOwnerId: actor.workspaceOwnerId,
    actorId: actor.actorId,
    batchRunId: trimmedRunId,
    itemId: trimmedItemId,
    stage: body.stage,
    skillIdOverride,
    skillSlugOverride,
    ...(body.stageParamsOverride !== undefined
      ? { stageParamsOverride: body.stageParamsOverride as StageParams | null }
      : {}),
    forceRerun: body.forceRerun === true,
    ...(typeof body.expectedRevision === 'number' ? { expectedRevision: body.expectedRevision } : {}),
    ...(shotIds !== undefined ? { shotIds } : {}),
    ...(body.pastedScript !== undefined ? { pastedScript: body.pastedScript as string | null } : {}),
    ...(body.sourceVideoMaterialId !== undefined
      ? { sourceVideoMaterialId: body.sourceVideoMaterialId as string | null }
      : {}),
    ...(body.sourceVideoStorageKey !== undefined
      ? { sourceVideoStorageKey: body.sourceVideoStorageKey as string | null }
      : {}),
    ...(body.sourceVideoUrl !== undefined ? { sourceVideoUrl: body.sourceVideoUrl as string | null } : {}),
    ...(body.sourceVideoFileName !== undefined
      ? { sourceVideoFileName: body.sourceVideoFileName as string | null }
      : {}),
    locale,
  })

  return NextResponse.json({
    queued: result.outcome === 'running',
    run: result.run,
    item: result.item,
    stage: result.stage,
    outcome: result.outcome,
    stageOutcome: result.outcome,
  })
})
