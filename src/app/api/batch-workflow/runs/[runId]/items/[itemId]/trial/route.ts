import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth, type AuthSession } from '@/lib/api-auth'
import { hasAccountPermissions, isManagementRole, normalizeAccountRole } from '@/lib/account/permissions'
import { setAccountActorContext } from '@/lib/account/request-context'
import { getWorkspaceActor, isProjectHiddenFromActor } from '@/lib/collaboration/access'
import { getBatchRunById } from '@/lib/batch-workflow/service'
import { runStageSkillTrial } from '@/lib/batch-workflow/executor'
import {
  isWorkflowStage,
  type StageParams,
  type StageSkillDraftPatch,
} from '@/lib/batch-workflow/types'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function assertWorkflowAdmin(session: AuthSession): void {
  const role = normalizeAccountRole(session.user.role)
  if (!isManagementRole(role) || !hasAccountPermissions(session.user, ['admin'])) {
    throw new ApiError('FORBIDDEN', {
      message: '仅管理员可执行 Skill A/B 试跑预览操作。',
    })
  }
}

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ runId: string; itemId: string }> },
) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  assertWorkflowAdmin(authResult.session)
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
    throw new ApiError('FORBIDDEN', { message: '当前账号无权试跑该工作流条目。' })
  }

  const body = await request.json().catch(() => null)
  if (!isPlainObject(body)) {
    throw new ApiError('INVALID_PARAMS', { message: '请求体必须为有效的 JSON 对象。' })
  }

  if (!isWorkflowStage(body.stage)) {
    throw new ApiError('INVALID_PARAMS', {
      message: '请指定有效的试跑阶段（stage：script_analysis / script_rewrite / asset_extraction / storyboard / video_gen）。',
    })
  }
  if (body.skillIdOverride !== undefined && body.skillIdOverride !== null && typeof body.skillIdOverride !== 'string') {
    throw new ApiError('INVALID_PARAMS', { message: 'skillIdOverride 必须为字符串或 null。' })
  }
  if (body.skillSlugOverride !== undefined && body.skillSlugOverride !== null && typeof body.skillSlugOverride !== 'string') {
    throw new ApiError('INVALID_PARAMS', { message: 'skillSlugOverride 必须为字符串或 null。' })
  }
  if (body.skillPatch !== undefined && body.skillPatch !== null && !isPlainObject(body.skillPatch)) {
    throw new ApiError('INVALID_PARAMS', { message: 'skillPatch 必须为对象或 null。' })
  }
  if (body.stageParamsOverride !== undefined && body.stageParamsOverride !== null && !isPlainObject(body.stageParamsOverride)) {
    throw new ApiError('INVALID_PARAMS', { message: 'stageParamsOverride 必须为对象或 null。' })
  }

  if (isPlainObject(body.skillPatch)) {
    const patch = body.skillPatch
    if (patch.name !== undefined && typeof patch.name !== 'string') {
      throw new ApiError('INVALID_PARAMS', { message: 'skillPatch.name 必须为字符串。' })
    }
    if (patch.systemPrompt !== undefined && typeof patch.systemPrompt !== 'string') {
      throw new ApiError('INVALID_PARAMS', { message: 'skillPatch.systemPrompt 必须为字符串。' })
    }
    if (patch.fewShotExamples !== undefined && !Array.isArray(patch.fewShotExamples)) {
      throw new ApiError('INVALID_PARAMS', { message: 'skillPatch.fewShotExamples 必须为数组。' })
    }
    if (patch.qcRules !== undefined && patch.qcRules !== null && !isPlainObject(patch.qcRules)) {
      throw new ApiError('INVALID_PARAMS', { message: 'skillPatch.qcRules 必须为对象或 null。' })
    }
    if (patch.modelPreferences !== undefined && patch.modelPreferences !== null && !isPlainObject(patch.modelPreferences)) {
      throw new ApiError('INVALID_PARAMS', { message: 'skillPatch.modelPreferences 必须为对象或 null。' })
    }
  }

  if (body.stage === 'video_gen') {
    if (body.confirmCost !== undefined && typeof body.confirmCost !== 'boolean') {
      throw new ApiError('INVALID_PARAMS', { message: 'confirmCost 必须为布尔值。' })
    }
    if (body.confirmCost === true && (typeof body.shotId !== 'string' || !body.shotId.trim())) {
      throw new ApiError('INVALID_PARAMS', { message: '真实试跑会消耗视频额度，请仅选择一个镜头并确认费用。' })
    }
  }

  const trial = await runStageSkillTrial({
    workspaceOwnerId: actor.workspaceOwnerId,
    actorId: actor.actorId,
    batchRunId: trimmedRunId,
    itemId: trimmedItemId,
    stage: body.stage,
    skillIdOverride: typeof body.skillIdOverride === 'string' ? body.skillIdOverride.trim() || null : null,
    skillSlugOverride: typeof body.skillSlugOverride === 'string' ? body.skillSlugOverride.trim() || null : null,
    skillPatch: (body.skillPatch as StageSkillDraftPatch | null | undefined) ?? null,
    stageParamsOverride: (body.stageParamsOverride as StageParams | null | undefined) ?? null,
    confirmCost: body.confirmCost === true,
    shotId: typeof body.shotId === 'string' ? body.shotId.trim() : null,
  })

  return NextResponse.json({ trial })
})
