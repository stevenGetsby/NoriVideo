import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'
import { setAccountActorContext } from '@/lib/account/request-context'
import { getWorkspaceActor, isProjectHiddenFromActor } from '@/lib/collaboration/access'
import {
  deleteBatchRun,
  getBatchRunById,
  getBatchRunWithStatusSync,
  updateBatchRun,
  updateBatchRunModelConfig,
  updateBatchRunStageConfig,
} from '@/lib/batch-workflow/service'
import {
  BATCH_RUN_MODE_VALUES,
  WORKFLOW_GATE_MODE_VALUES,
  isWorkflowStage,
  type BatchRunMode,
  type StageParams,
  type UpdateBatchRunInput,
  type WorkflowGateMode,
  type WorkflowModelConfig,
  type WorkflowStage,
  type WorkflowStageParamsMap,
} from '@/lib/batch-workflow/types'

const ALLOWED_PATCH_STATUSES = new Set(['paused', 'running', 'draft'])

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

interface ParsedStageConfigPatch {
  stage: WorkflowStage
  patch: {
    skillId?: string | null
    skillSlug?: string | null
    gateMode?: WorkflowGateMode
    enabled?: boolean
    stageParams?: StageParams | null
  }
}

function parseSingleStageConfigPatch(raw: unknown, label: string): ParsedStageConfigPatch {
  if (!isPlainObject(raw)) {
    throw new ApiError('INVALID_PARAMS', { message: `${label} 必须为对象。` })
  }
  if (!isWorkflowStage(raw.stage)) {
    throw new ApiError('INVALID_PARAMS', { message: `${label}.stage 无效，必须为 5 个标准阶段之一。` })
  }
  const source = isPlainObject(raw.patch) ? raw.patch : raw
  if (source.skillId !== undefined && source.skillId !== null && typeof source.skillId !== 'string') {
    throw new ApiError('INVALID_PARAMS', { message: `${label}.skillId 必须为字符串或 null。` })
  }
  if (source.skillSlug !== undefined && source.skillSlug !== null && typeof source.skillSlug !== 'string') {
    throw new ApiError('INVALID_PARAMS', { message: `${label}.skillSlug 必须为字符串或 null。` })
  }
  if (
    source.gateMode !== undefined
    && !WORKFLOW_GATE_MODE_VALUES.includes(source.gateMode as WorkflowGateMode)
  ) {
    throw new ApiError('INVALID_PARAMS', { message: `${label}.gateMode 必须为 auto 或 manual_review。` })
  }
  if (source.enabled !== undefined && typeof source.enabled !== 'boolean') {
    throw new ApiError('INVALID_PARAMS', { message: `${label}.enabled 必须为布尔值。` })
  }
  if (source.stageParams !== undefined && source.stageParams !== null && !isPlainObject(source.stageParams)) {
    throw new ApiError('INVALID_PARAMS', { message: `${label}.stageParams 必须为对象或 null。` })
  }

  return {
    stage: raw.stage,
    patch: {
      ...(source.skillId !== undefined
        ? { skillId: typeof source.skillId === 'string' ? source.skillId.trim() || null : null }
        : {}),
      ...(source.skillSlug !== undefined
        ? { skillSlug: typeof source.skillSlug === 'string' ? source.skillSlug.trim() || null : null }
        : {}),
      ...(source.gateMode !== undefined ? { gateMode: source.gateMode as WorkflowGateMode } : {}),
      ...(source.enabled !== undefined ? { enabled: source.enabled as boolean } : {}),
      ...(source.stageParams !== undefined ? { stageParams: source.stageParams as StageParams | null } : {}),
    },
  }
}

export const GET = apiHandler(async (
  _request: NextRequest,
  context: { params: Promise<{ runId: string }> },
) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const actor = getWorkspaceActor(authResult.session)
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
    throw new ApiError('NOT_FOUND', { message: '工作流批次不存在或无权访问。' })
  }
  if (await isProjectHiddenFromActor(actor, existing.projectId)) {
    throw new ApiError('FORBIDDEN', { message: '当前账号无权访问该工作流所属作品。' })
  }

  const run = await getBatchRunWithStatusSync({
    workspaceOwnerId: actor.workspaceOwnerId,
    runId: trimmedId,
  })
  if (!run) {
    throw new ApiError('NOT_FOUND', { message: '工作流批次不存在或无权访问。' })
  }

  return NextResponse.json({ run })
})

export const PATCH = apiHandler(async (
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
    throw new ApiError('FORBIDDEN', { message: '当前账号无权操作该工作流所属作品。' })
  }

  const body = await request.json().catch(() => null)
  if (!isPlainObject(body)) {
    throw new ApiError('INVALID_PARAMS', { message: '请求体必须为有效的 JSON 对象。' })
  }

  const rawTitle = body.title !== undefined ? body.title : body.name
  if (rawTitle !== undefined && (typeof rawTitle !== 'string' || !rawTitle.trim())) {
    throw new ApiError('INVALID_PARAMS', { message: '批次标题不能为空。' })
  }
  if (body.runMode !== undefined && !BATCH_RUN_MODE_VALUES.includes(body.runMode as BatchRunMode)) {
    throw new ApiError('INVALID_PARAMS', { message: 'runMode 必须为 gated 或 auto。' })
  }
  if (body.status !== undefined && (typeof body.status !== 'string' || !ALLOWED_PATCH_STATUSES.has(body.status))) {
    throw new ApiError('INVALID_PARAMS', { message: 'status 仅支持 paused、running 或 draft。' })
  }
  if (body.modelConfig !== undefined && body.modelConfig !== null && !isPlainObject(body.modelConfig)) {
    throw new ApiError('INVALID_PARAMS', { message: 'modelConfig 必须为对象。' })
  }
  if (body.stageSkillOverrides !== undefined && body.stageSkillOverrides !== null && !isPlainObject(body.stageSkillOverrides)) {
    throw new ApiError('INVALID_PARAMS', { message: 'stageSkillOverrides 必须为对象。' })
  }
  if (body.stageGateOverrides !== undefined && body.stageGateOverrides !== null && !isPlainObject(body.stageGateOverrides)) {
    throw new ApiError('INVALID_PARAMS', { message: 'stageGateOverrides 必须为对象。' })
  }
  if (body.stageParams !== undefined && body.stageParams !== null && !isPlainObject(body.stageParams)) {
    throw new ApiError('INVALID_PARAMS', { message: 'stageParams 必须为对象。' })
  }

  const stagePatches: ParsedStageConfigPatch[] = []
  if (isPlainObject(body.stageSkillOverrides)) {
    for (const [stageKey, value] of Object.entries(body.stageSkillOverrides)) {
      if (!isWorkflowStage(stageKey)) {
        throw new ApiError('INVALID_PARAMS', { message: `stageSkillOverrides 包含无效阶段：${stageKey}` })
      }
      if (value === null || value === undefined || value === '') continue
      if (typeof value !== 'string') {
        throw new ApiError('INVALID_PARAMS', { message: `stageSkillOverrides.${stageKey} 必须为字符串。` })
      }
      const trimmed = value.trim()
      if (!trimmed) continue
      stagePatches.push({
        stage: stageKey,
        patch: { skillId: trimmed, skillSlug: trimmed },
      })
    }
  }
  if (body.stageConfigPatch !== undefined && body.stageConfigPatch !== null) {
    if (Array.isArray(body.stageConfigPatch)) {
      body.stageConfigPatch.forEach((entry, idx) => {
        stagePatches.push(parseSingleStageConfigPatch(entry, `stageConfigPatch[${idx}]`))
      })
    } else {
      stagePatches.push(parseSingleStageConfigPatch(body.stageConfigPatch, 'stageConfigPatch'))
    }
  }
  if (body.stage !== undefined) {
    stagePatches.push(parseSingleStageConfigPatch(body, 'stage'))
  }

  let run = null

  const hasBaseUpdate =
    rawTitle !== undefined
    || body.runMode !== undefined
    || body.status !== undefined
    || body.stageGateOverrides !== undefined
    || body.stageParams !== undefined

  if (hasBaseUpdate) {
    const input: UpdateBatchRunInput = {
      ...(rawTitle !== undefined ? { title: (rawTitle as string).trim() } : {}),
      ...(body.runMode !== undefined ? { runMode: body.runMode as BatchRunMode } : {}),
      ...(body.status !== undefined ? { status: body.status as 'paused' | 'running' | 'draft' } : {}),
      ...(body.stageGateOverrides !== undefined
        ? { stageGateOverrides: body.stageGateOverrides as Partial<Record<WorkflowStage, WorkflowGateMode>> | null }
        : {}),
      ...(body.stageParams !== undefined
        ? { stageParams: body.stageParams as WorkflowStageParamsMap | null }
        : {}),
    }
    run = await updateBatchRun({
      workspaceOwnerId: actor.workspaceOwnerId,
      actorId: actor.actorId,
      runId: trimmedId,
      input,
    })
  }

  if (isPlainObject(body.modelConfig)) {
    run = await updateBatchRunModelConfig({
      workspaceOwnerId: actor.workspaceOwnerId,
      actorId: actor.actorId,
      runId: trimmedId,
      modelConfig: body.modelConfig as Partial<WorkflowModelConfig>,
    })
  }

  for (const stagePatch of stagePatches) {
    run = await updateBatchRunStageConfig({
      workspaceOwnerId: actor.workspaceOwnerId,
      runId: trimmedId,
      stage: stagePatch.stage,
      patch: stagePatch.patch,
    })
  }

  if (!run) {
    run = await getBatchRunById({
      workspaceOwnerId: actor.workspaceOwnerId,
      runId: trimmedId,
      includeItems: true,
    })
    if (!run) {
      throw new ApiError('NOT_FOUND', { message: '工作流批次不存在或无权操作。' })
    }
  }

  return NextResponse.json({ run })
})

export const DELETE = apiHandler(async (
  _request: NextRequest,
  context: { params: Promise<{ runId: string }> },
) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const actor = getWorkspaceActor(authResult.session)
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
    throw new ApiError('NOT_FOUND', { message: '工作流批次不存在或无权删除。' })
  }
  if (await isProjectHiddenFromActor(actor, existing.projectId)) {
    throw new ApiError('FORBIDDEN', { message: '当前账号无权删除该工作流批次。' })
  }

  const result = await deleteBatchRun({
    workspaceOwnerId: actor.workspaceOwnerId,
    runId: trimmedId,
  })

  return NextResponse.json({ ok: true, success: true, runId: result.id })
})
