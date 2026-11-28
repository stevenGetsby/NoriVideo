import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth, type AuthSession } from '@/lib/api-auth'
import { hasAccountPermissions, isManagementRole, normalizeAccountRole } from '@/lib/account/permissions'
import { getWorkspaceActor } from '@/lib/collaboration/access'
import {
  deleteWorkflowTemplate,
  getWorkflowTemplateById,
  updateWorkflowTemplate,
} from '@/lib/batch-workflow/service'
import {
  isWorkflowStage,
  WORKFLOW_GATE_MODE_VALUES,
  WORKFLOW_STAGE_META,
  type UpdateWorkflowTemplateInput,
  type WorkflowGateMode,
  type WorkflowTemplateStageConfig,
} from '@/lib/batch-workflow/types'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function assertWorkflowAdmin(session: AuthSession): void {
  const role = normalizeAccountRole(session.user.role)
  if (!isManagementRole(role) || !hasAccountPermissions(session.user, ['admin'])) {
    throw new ApiError('FORBIDDEN', {
      message: '仅管理员可执行赛道模板修改或删除操作。',
    })
  }
}

function validateTemplateStages(raw: unknown): WorkflowTemplateStageConfig[] {
  if (!Array.isArray(raw)) {
    throw new ApiError('INVALID_PARAMS', { message: 'stages 必须为阶段配置数组。' })
  }
  return raw.map((entry, idx) => {
    if (!isPlainObject(entry)) {
      throw new ApiError('INVALID_PARAMS', { message: `stages[${idx}] 必须为对象。` })
    }
    if (!isWorkflowStage(entry.stage)) {
      throw new ApiError('INVALID_PARAMS', {
        message: `stages[${idx}].stage 无效，必须为 5 个标准阶段（script_analysis / script_rewrite / asset_extraction / storyboard / video_gen）之一。`,
      })
    }
    if (
      entry.gateMode !== undefined
      && !WORKFLOW_GATE_MODE_VALUES.includes(entry.gateMode as WorkflowGateMode)
    ) {
      throw new ApiError('INVALID_PARAMS', { message: `stages[${idx}].gateMode 必须为 auto 或 manual_review。` })
    }
    if (entry.enabled !== undefined && typeof entry.enabled !== 'boolean') {
      throw new ApiError('INVALID_PARAMS', { message: `stages[${idx}].enabled 必须为布尔值。` })
    }
    if (entry.options !== undefined && entry.options !== null && !isPlainObject(entry.options)) {
      throw new ApiError('INVALID_PARAMS', { message: `stages[${idx}].options 必须为对象或 null。` })
    }
    return {
      stage: entry.stage,
      label: typeof entry.label === 'string' ? entry.label.trim() : '',
      skillSlug: typeof entry.skillSlug === 'string' ? entry.skillSlug.trim() : '',
      skillId: typeof entry.skillId === 'string' ? entry.skillId.trim() || null : null,
      gateMode: (entry.gateMode as WorkflowGateMode | undefined) ?? WORKFLOW_STAGE_META[entry.stage].defaultGateMode,
      enabled: entry.enabled !== false,
      modelKey: typeof entry.modelKey === 'string' ? entry.modelKey.trim() || null : null,
      options: (entry.options as Record<string, unknown> | null | undefined) ?? null,
    }
  })
}

export const GET = apiHandler(async (
  _request: NextRequest,
  context: { params: Promise<{ templateId: string }> },
) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const actor = getWorkspaceActor(authResult.session)
  const { templateId } = await context.params

  const trimmedId = templateId?.trim()
  if (!trimmedId) {
    throw new ApiError('INVALID_PARAMS', { message: '缺少 templateId 参数。' })
  }

  const template = await getWorkflowTemplateById({
    workspaceOwnerId: actor.workspaceOwnerId,
    templateId: trimmedId,
  })
  if (!template) {
    throw new ApiError('NOT_FOUND', { message: '赛道模板不存在或无权访问。' })
  }

  return NextResponse.json({ template })
})

export const PATCH = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ templateId: string }> },
) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  assertWorkflowAdmin(authResult.session)
  const actor = getWorkspaceActor(authResult.session)
  const { templateId } = await context.params

  const trimmedId = templateId?.trim()
  if (!trimmedId) {
    throw new ApiError('INVALID_PARAMS', { message: '缺少 templateId 参数。' })
  }

  const body = await request.json().catch(() => null)
  if (!isPlainObject(body)) {
    throw new ApiError('INVALID_PARAMS', { message: '请求体必须为有效的 JSON 对象。' })
  }

  if (body.name !== undefined && (typeof body.name !== 'string' || !body.name.trim())) {
    throw new ApiError('INVALID_PARAMS', { message: '赛道模板名称不能为空。' })
  }
  if (body.description !== undefined && body.description !== null && typeof body.description !== 'string') {
    throw new ApiError('INVALID_PARAMS', { message: 'description 必须为字符串或 null。' })
  }
  if (body.isDefault !== undefined && typeof body.isDefault !== 'boolean') {
    throw new ApiError('INVALID_PARAMS', { message: 'isDefault 必须为布尔值。' })
  }

  const input: UpdateWorkflowTemplateInput = {
    ...(body.name !== undefined ? { name: (body.name as string).trim() } : {}),
    ...(body.description !== undefined
      ? { description: body.description === null ? null : (body.description as string).trim() }
      : {}),
    ...(body.stages !== undefined ? { stages: validateTemplateStages(body.stages) } : {}),
    ...(body.isDefault !== undefined ? { isDefault: body.isDefault as boolean } : {}),
  }

  const template = await updateWorkflowTemplate({
    workspaceOwnerId: actor.workspaceOwnerId,
    templateId: trimmedId,
    input,
  })

  return NextResponse.json({ template })
})

export const DELETE = apiHandler(async (
  _request: NextRequest,
  context: { params: Promise<{ templateId: string }> },
) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  assertWorkflowAdmin(authResult.session)
  const actor = getWorkspaceActor(authResult.session)
  const { templateId } = await context.params

  const trimmedId = templateId?.trim()
  if (!trimmedId) {
    throw new ApiError('INVALID_PARAMS', { message: '缺少 templateId 参数。' })
  }

  const result = await deleteWorkflowTemplate({
    workspaceOwnerId: actor.workspaceOwnerId,
    templateId: trimmedId,
  })

  return NextResponse.json({ ok: true, success: true, templateId: result.id })
})
