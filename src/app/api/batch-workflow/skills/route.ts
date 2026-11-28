import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth, type AuthSession } from '@/lib/api-auth'
import { hasAccountPermissions, isManagementRole, normalizeAccountRole } from '@/lib/account/permissions'
import { getWorkspaceActor } from '@/lib/collaboration/access'
import {
  createWorkflowSkill,
  listWorkflowSkills,
  toWorkflowSkillSummary,
} from '@/lib/batch-workflow/service'
import {
  isWorkflowStage,
  type CreateWorkflowSkillInput,
  type WorkflowSkillFewShotExample,
  type WorkflowSkillModelPreferences,
  type WorkflowSkillQcRules,
  type WorkflowStage,
} from '@/lib/batch-workflow/types'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isWorkflowAdmin(session: AuthSession): boolean {
  const role = normalizeAccountRole(session.user.role)
  return isManagementRole(role) && hasAccountPermissions(session.user, ['admin'])
}

function assertWorkflowAdmin(session: AuthSession): void {
  if (!isWorkflowAdmin(session)) {
    throw new ApiError('FORBIDDEN', {
      message: '仅管理员可执行 Skill 创建与管理操作。',
    })
  }
}

function cleanOptionalString(value: unknown, fieldLabel: string, maxLen = 191): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') {
    throw new ApiError('INVALID_PARAMS', { message: `${fieldLabel}必须为字符串。` })
  }
  const trimmed = value.trim()
  if (!trimmed) return undefined
  if (trimmed.length > maxLen) {
    throw new ApiError('INVALID_PARAMS', { message: `${fieldLabel}不能超过 ${maxLen} 个字符。` })
  }
  return trimmed
}

export const GET = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const actor = getWorkspaceActor(authResult.session)
  const admin = isWorkflowAdmin(authResult.session)

  const params = request.nextUrl.searchParams
  const rawTrack = params.get('track')?.trim() || undefined
  const rawStage = params.get('stage')?.trim() || undefined
  const rawIncludeAllVersions = params.get('includeAllVersions')?.trim().toLowerCase()
  const includeAllVersions = rawIncludeAllVersions === 'true' || rawIncludeAllVersions === '1'
  const rawView = params.get('view')?.trim().toLowerCase()
  // Contract: `view=summary` returns summary fields; non-admin always degrades to summary.
  const wantSummary = rawView === 'summary' || !admin

  let stage: WorkflowStage | undefined
  if (rawStage) {
    if (!isWorkflowStage(rawStage)) {
      throw new ApiError('INVALID_PARAMS', {
        message: 'stage 参数无效，必须为 script_analysis、script_rewrite、asset_extraction、storyboard 或 video_gen 之一。',
      })
    }
    stage = rawStage
  }

  const skills = await listWorkflowSkills({
    workspaceOwnerId: actor.workspaceOwnerId,
    ...(rawTrack ? { track: rawTrack } : {}),
    ...(stage ? { stage } : {}),
    ...(includeAllVersions ? { includeAllVersions: true } : {}),
  })

  return NextResponse.json({
    skills: wantSummary ? skills.map(toWorkflowSkillSummary) : skills,
  })
})

export const POST = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  assertWorkflowAdmin(authResult.session)
  const actor = getWorkspaceActor(authResult.session)

  const body = await request.json().catch(() => null)
  if (!isPlainObject(body)) {
    throw new ApiError('INVALID_PARAMS', { message: '请求体必须为有效的 JSON 对象。' })
  }

  const cloneFromSkillId = cleanOptionalString(body.cloneFromSkillId, 'cloneFromSkillId', 191) ?? null
  const parentSkillId = cleanOptionalString(body.parentSkillId, 'parentSkillId', 191) ?? null
  const changeNote = cleanOptionalString(body.changeNote, 'changeNote', 2000) ?? null

  let stage: WorkflowStage | undefined
  if (body.stage !== undefined && body.stage !== null && body.stage !== '') {
    if (!isWorkflowStage(body.stage)) {
      throw new ApiError('INVALID_PARAMS', {
        message: 'Skill 所属阶段无效，必须为 5 个标准阶段（script_analysis / script_rewrite / asset_extraction / storyboard / video_gen）之一。',
      })
    }
    stage = body.stage
  } else if (!cloneFromSkillId) {
    throw new ApiError('INVALID_PARAMS', { message: '请选择 Skill 所属阶段（stage）。' })
  }

  const name = cleanOptionalString(body.name, 'Skill 名称', 191)
  if (!name && !cloneFromSkillId) {
    throw new ApiError('INVALID_PARAMS', { message: 'Skill 名称不能为空。' })
  }

  let systemPrompt = ''
  if (body.systemPrompt !== undefined && body.systemPrompt !== null) {
    if (typeof body.systemPrompt !== 'string') {
      throw new ApiError('INVALID_PARAMS', { message: 'systemPrompt 必须为字符串。' })
    }
    systemPrompt = body.systemPrompt.trim()
  }
  if (!systemPrompt && !cloneFromSkillId) {
    throw new ApiError('INVALID_PARAMS', { message: 'Skill 提示词（systemPrompt）不能为空。' })
  }

  if (body.fewShotExamples !== undefined && !Array.isArray(body.fewShotExamples)) {
    throw new ApiError('INVALID_PARAMS', { message: 'fewShotExamples 必须为数组。' })
  }
  if (body.outputSchema !== undefined && body.outputSchema !== null && !isPlainObject(body.outputSchema)) {
    throw new ApiError('INVALID_PARAMS', { message: 'outputSchema 必须为对象或 null。' })
  }
  if (body.modelPreferences !== undefined && body.modelPreferences !== null && !isPlainObject(body.modelPreferences)) {
    throw new ApiError('INVALID_PARAMS', { message: 'modelPreferences 必须为对象或 null。' })
  }
  if (body.qcRules !== undefined && body.qcRules !== null && !isPlainObject(body.qcRules)) {
    throw new ApiError('INVALID_PARAMS', { message: 'qcRules 必须为对象或 null。' })
  }
  if (body.isDefault !== undefined && typeof body.isDefault !== 'boolean') {
    throw new ApiError('INVALID_PARAMS', { message: 'isDefault 必须为布尔值。' })
  }
  if (body.description !== undefined && body.description !== null && typeof body.description !== 'string') {
    throw new ApiError('INVALID_PARAMS', { message: 'description 必须为字符串或 null。' })
  }

  const input: CreateWorkflowSkillInput = {
    slug: cleanOptionalString(body.slug, 'slug', 128),
    name: name ?? '',
    track: cleanOptionalString(body.track, 'track', 64),
    stage: stage ?? ('' as unknown as WorkflowStage),
    description: body.description === undefined ? undefined : (body.description === null ? null : body.description.trim()),
    systemPrompt,
    ...(body.fewShotExamples !== undefined ? { fewShotExamples: body.fewShotExamples as WorkflowSkillFewShotExample[] } : {}),
    ...(body.outputSchema !== undefined ? { outputSchema: body.outputSchema as Record<string, unknown> | null } : {}),
    ...(body.modelPreferences !== undefined ? { modelPreferences: body.modelPreferences as WorkflowSkillModelPreferences | null } : {}),
    ...(body.qcRules !== undefined ? { qcRules: body.qcRules as WorkflowSkillQcRules | null } : {}),
    ...(body.isDefault !== undefined ? { isDefault: body.isDefault } : {}),
    ...(cloneFromSkillId ? { cloneFromSkillId } : {}),
    ...(parentSkillId ? { parentSkillId } : {}),
    ...(changeNote ? { changeNote } : {}),
  }

  const skill = await createWorkflowSkill({
    workspaceOwnerId: actor.workspaceOwnerId,
    input,
  })

  return NextResponse.json({ skill }, { status: 201 })
})
