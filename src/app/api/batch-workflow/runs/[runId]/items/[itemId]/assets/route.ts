import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'
import { setAccountActorContext } from '@/lib/account/request-context'
import { getWorkspaceActor, isProjectHiddenFromActor } from '@/lib/collaboration/access'
import { resolveTaskLocale } from '@/lib/task/resolve-locale'
import { getBatchRunById } from '@/lib/batch-workflow/service'
import {
  bindBatchItemAssetMaterial,
  generateBatchItemAssets,
} from '@/lib/batch-workflow/executor'
import type { ImageQualityLevel } from '@/lib/batch-workflow/types'

const ALLOWED_IMAGE_QUALITIES = new Set<ImageQualityLevel>(['low', 'medium', 'high'])

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
    throw new ApiError('FORBIDDEN', { message: '当前账号无权操作该工作流的资产。' })
  }

  const body = await request.json().catch(() => null)
  if (!isPlainObject(body)) {
    throw new ApiError('INVALID_PARAMS', { message: '请求体必须为有效的 JSON 对象。' })
  }

  if (body.expectedRevision !== undefined && (typeof body.expectedRevision !== 'number' || !Number.isInteger(body.expectedRevision) || body.expectedRevision < 0)) {
    throw new ApiError('INVALID_PARAMS', { message: 'expectedRevision 必须为非负整数。' })
  }

  if (body.action === 'generate') {
    let assetItemIds: string[] | undefined
    if (body.assetItemIds !== undefined) {
      if (!Array.isArray(body.assetItemIds) || body.assetItemIds.some((id) => typeof id !== 'string' || !id.trim())) {
        throw new ApiError('INVALID_PARAMS', { message: 'assetItemIds 必须为非空字符串数组。' })
      }
      assetItemIds = body.assetItemIds.map((id) => (id as string).trim())
    }
    if (body.imageModelKeyOverride !== undefined && body.imageModelKeyOverride !== null && typeof body.imageModelKeyOverride !== 'string') {
      throw new ApiError('INVALID_PARAMS', { message: 'imageModelKeyOverride 必须为字符串或 null。' })
    }
    if (body.resolutionOverride !== undefined && body.resolutionOverride !== null && typeof body.resolutionOverride !== 'string') {
      throw new ApiError('INVALID_PARAMS', { message: 'resolutionOverride 必须为字符串或 null。' })
    }
    if (
      body.qualityOverride !== undefined
      && body.qualityOverride !== null
      && (typeof body.qualityOverride !== 'string' || !ALLOWED_IMAGE_QUALITIES.has(body.qualityOverride as ImageQualityLevel))
    ) {
      throw new ApiError('INVALID_PARAMS', { message: 'qualityOverride 必须为 low、medium、high 或 null。' })
    }

    const locale = resolveTaskLocale(request, body) ?? 'zh'
    const result = await generateBatchItemAssets({
      workspaceOwnerId: actor.workspaceOwnerId,
      actorId: actor.actorId,
      batchRunId: trimmedRunId,
      itemId: trimmedItemId,
      ...(assetItemIds !== undefined ? { assetItemIds } : {}),
      ...(body.imageModelKeyOverride !== undefined
        ? { imageModelKeyOverride: typeof body.imageModelKeyOverride === 'string' ? body.imageModelKeyOverride.trim() || null : null }
        : {}),
      ...(body.resolutionOverride !== undefined
        ? { resolutionOverride: typeof body.resolutionOverride === 'string' ? body.resolutionOverride.trim() || null : null }
        : {}),
      ...(body.qualityOverride !== undefined
        ? { qualityOverride: (body.qualityOverride as ImageQualityLevel | null) ?? null }
        : {}),
      ...(typeof body.expectedRevision === 'number' ? { expectedRevision: body.expectedRevision } : {}),
      locale,
    })

    return NextResponse.json({
      run: result.run,
      item: result.item,
      submittedCount: result.submittedCount,
      failedCount: result.failedCount,
      taskIds: result.taskIds,
    })
  }

  if (body.action === 'bind') {
    const assetItemId = typeof body.assetItemId === 'string' ? body.assetItemId.trim() : ''
    if (!assetItemId) {
      throw new ApiError('INVALID_PARAMS', { message: '缺少目标资产标识（assetItemId）。' })
    }
    if (body.materialId !== undefined && body.materialId !== null && typeof body.materialId !== 'string') {
      throw new ApiError('INVALID_PARAMS', { message: 'materialId 必须为字符串或 null。' })
    }
    if (body.voiceMaterialId !== undefined && body.voiceMaterialId !== null && typeof body.voiceMaterialId !== 'string') {
      throw new ApiError('INVALID_PARAMS', { message: 'voiceMaterialId 必须为字符串或 null。' })
    }
    if (body.clearVoice !== undefined && typeof body.clearVoice !== 'boolean') {
      throw new ApiError('INVALID_PARAMS', { message: 'clearVoice 必须为布尔值。' })
    }
    if (
      body.selectVersionIndex !== undefined
      && body.selectVersionIndex !== null
      && (typeof body.selectVersionIndex !== 'number' || !Number.isInteger(body.selectVersionIndex) || body.selectVersionIndex < 0)
    ) {
      throw new ApiError('INVALID_PARAMS', { message: 'selectVersionIndex 必须为非负整数或 null。' })
    }

    const result = await bindBatchItemAssetMaterial({
      workspaceOwnerId: actor.workspaceOwnerId,
      batchRunId: trimmedRunId,
      itemId: trimmedItemId,
      assetItemId,
      ...(body.materialId !== undefined
        ? { materialId: typeof body.materialId === 'string' ? body.materialId.trim() || null : null }
        : {}),
      ...(body.voiceMaterialId !== undefined
        ? { voiceMaterialId: typeof body.voiceMaterialId === 'string' ? body.voiceMaterialId.trim() || null : null }
        : {}),
      ...(body.clearVoice !== undefined ? { clearVoice: body.clearVoice as boolean } : {}),
      ...(body.selectVersionIndex !== undefined
        ? { selectVersionIndex: (body.selectVersionIndex as number | null) ?? null }
        : {}),
      ...(typeof body.expectedRevision === 'number' ? { expectedRevision: body.expectedRevision } : {}),
    })

    return NextResponse.json({
      run: result.run,
      item: result.item,
    })
  }

  throw new ApiError('INVALID_PARAMS', { message: 'action 必须为 generate 或 bind。' })
})
