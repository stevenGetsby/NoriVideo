import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth, type AuthSession } from '@/lib/api-auth'
import { hasAccountPermissions, isManagementRole, normalizeAccountRole } from '@/lib/account/permissions'
import { getWorkspaceActor } from '@/lib/collaboration/access'
import {
  deleteWorkflowSkill,
  getWorkflowSkillById,
  listSkillVersions,
  toWorkflowSkillSummary,
  updateWorkflowSkill,
} from '@/lib/batch-workflow/service'
import type {
  UpdateWorkflowSkillInput,
  WorkflowSkillFewShotExample,
  WorkflowSkillModelPreferences,
  WorkflowSkillQcRules,
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
      message: '仅管理员可执行 Skill 修改、发版或删除操作。',
    })
  }
}

export const GET = apiHandler(async (
  _request: NextRequest,
  context: { params: Promise<{ skillId: string }> },
) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const actor = getWorkspaceActor(authResult.session)
  const admin = isWorkflowAdmin(authResult.session)
  const { skillId } = await context.params

  const trimmedId = skillId?.trim()
  if (!trimmedId) {
    throw new ApiError('INVALID_PARAMS', { message: '缺少 skillId 参数。' })
  }

  const skill = await getWorkflowSkillById({
    workspaceOwnerId: actor.workspaceOwnerId,
    skillId: trimmedId,
  })
  if (!skill) {
    throw new ApiError('NOT_FOUND', { message: 'Skill 不存在或无权访问。' })
  }

  const versions = await listSkillVersions({
    workspaceOwnerId: actor.workspaceOwnerId,
    slug: skill.slug,
  })

  if (admin) {
    return NextResponse.json({ skill, versions })
  }
  // Non-admin: degrade to summary view (no systemPrompt/fewShot/qc/model/schema).
  return NextResponse.json({
    skill: toWorkflowSkillSummary(skill),
    versions: versions.map(toWorkflowSkillSummary),
  })
})

export const PATCH = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ skillId: string }> },
) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  assertWorkflowAdmin(authResult.session)
  const actor = getWorkspaceActor(authResult.session)
  const { skillId } = await context.params

  const trimmedId = skillId?.trim()
  if (!trimmedId) {
    throw new ApiError('INVALID_PARAMS', { message: '缺少 skillId 参数。' })
  }

  const body = await request.json().catch(() => null)
  if (!isPlainObject(body)) {
    throw new ApiError('INVALID_PARAMS', { message: '请求体必须为有效的 JSON 对象。' })
  }

  if (body.saveAsNewVersion !== undefined && typeof body.saveAsNewVersion !== 'boolean') {
    throw new ApiError('INVALID_PARAMS', { message: 'saveAsNewVersion 必须为布尔值。' })
  }
  if (body.name !== undefined && (typeof body.name !== 'string' || !body.name.trim())) {
    throw new ApiError('INVALID_PARAMS', { message: 'Skill 名称不能为空。' })
  }
  if (body.systemPrompt !== undefined && (typeof body.systemPrompt !== 'string' || !body.systemPrompt.trim())) {
    throw new ApiError('INVALID_PARAMS', { message: 'Skill 提示词（systemPrompt）不能为空。' })
  }
  if (body.description !== undefined && body.description !== null && typeof body.description !== 'string') {
    throw new ApiError('INVALID_PARAMS', { message: 'description 必须为字符串或 null。' })
  }
  if (body.changeNote !== undefined && body.changeNote !== null && typeof body.changeNote !== 'string') {
    throw new ApiError('INVALID_PARAMS', { message: 'changeNote 必须为字符串或 null。' })
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

  const baseInput: UpdateWorkflowSkillInput = {
    ...(body.name !== undefined ? { name: (body.name as string).trim() } : {}),
    ...(body.description !== undefined
      ? { description: body.description === null ? null : (body.description as string).trim() }
      : {}),
    ...(body.systemPrompt !== undefined ? { systemPrompt: (body.systemPrompt as string).trim() } : {}),
    ...(body.changeNote !== undefined
      ? { changeNote: body.changeNote === null ? null : (body.changeNote as string).trim() }
      : {}),
    ...(body.fewShotExamples !== undefined ? { fewShotExamples: body.fewShotExamples as WorkflowSkillFewShotExample[] } : {}),
    ...(body.outputSchema !== undefined ? { outputSchema: body.outputSchema as Record<string, unknown> | null } : {}),
    ...(body.modelPreferences !== undefined ? { modelPreferences: body.modelPreferences as WorkflowSkillModelPreferences | null } : {}),
    ...(body.qcRules !== undefined ? { qcRules: body.qcRules as WorkflowSkillQcRules | null } : {}),
    ...(body.isDefault !== undefined ? { isDefault: body.isDefault as boolean } : {}),
  }

  // updateWorkflowSkill internally routes to publishWorkflowSkillVersion when saveAsNewVersion is true;
  // otherwise it rejects content-field edits with INVALID_PARAMS ("已发布版本不可原地修改，请发布为新版本").
  const skill = await updateWorkflowSkill({
    workspaceOwnerId: actor.workspaceOwnerId,
    skillId: trimmedId,
    input: baseInput,
    saveAsNewVersion: body.saveAsNewVersion === true,
  })

  return NextResponse.json({ skill })
})

export const DELETE = apiHandler(async (
  _request: NextRequest,
  context: { params: Promise<{ skillId: string }> },
) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  assertWorkflowAdmin(authResult.session)
  const actor = getWorkspaceActor(authResult.session)
  const { skillId } = await context.params

  const trimmedId = skillId?.trim()
  if (!trimmedId) {
    throw new ApiError('INVALID_PARAMS', { message: '缺少 skillId 参数。' })
  }

  const result = await deleteWorkflowSkill({
    workspaceOwnerId: actor.workspaceOwnerId,
    skillId: trimmedId,
  })

  return NextResponse.json({ ok: true, success: true, skillId: result.id })
})
