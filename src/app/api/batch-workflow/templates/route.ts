import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth, type AuthSession } from '@/lib/api-auth'
import { hasAccountPermissions, isManagementRole, normalizeAccountRole } from '@/lib/account/permissions'
import { getWorkspaceActor } from '@/lib/collaboration/access'
import { createWorkflowTemplate, listWorkflowTemplates } from '@/lib/batch-workflow/service'
import {
  isWorkflowStage,
  WORKFLOW_GATE_MODE_VALUES,
  WORKFLOW_STAGE_META,
  type CreateWorkflowTemplateInput,
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
      message: '仅管理员可执行赛道模板创建与管理操作。',
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

export const GET = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const actor = getWorkspaceActor(authResult.session)

  const track = request.nextUrl.searchParams.get('track')?.trim() || undefined
  const templates = await listWorkflowTemplates({
    workspaceOwnerId: actor.workspaceOwnerId,
    ...(track ? { track } : {}),
  })

  return NextResponse.json({ templates })
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

  const cloneFromTemplateId = typeof body.cloneFromTemplateId === 'string'
    ? body.cloneFromTemplateId.trim() || null
    : body.cloneFromTemplateId === undefined || body.cloneFromTemplateId === null
      ? null
      : (() => { throw new ApiError('INVALID_PARAMS', { message: 'cloneFromTemplateId 必须为字符串。' }) })()

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (body.name !== undefined && typeof body.name !== 'string') {
    throw new ApiError('INVALID_PARAMS', { message: '赛道模板名称必须为字符串。' })
  }
  if (!name && !cloneFromTemplateId) {
    throw new ApiError('INVALID_PARAMS', { message: '赛道模板名称不能为空。' })
  }
  if (body.description !== undefined && body.description !== null && typeof body.description !== 'string') {
    throw new ApiError('INVALID_PARAMS', { message: 'description 必须为字符串或 null。' })
  }
  if (body.isDefault !== undefined && typeof body.isDefault !== 'boolean') {
    throw new ApiError('INVALID_PARAMS', { message: 'isDefault 必须为布尔值。' })
  }
  if (body.slug !== undefined && typeof body.slug !== 'string') {
    throw new ApiError('INVALID_PARAMS', { message: 'slug 必须为字符串。' })
  }
  if (body.track !== undefined && typeof body.track !== 'string') {
    throw new ApiError('INVALID_PARAMS', { message: 'track 必须为字符串。' })
  }

  const stages = body.stages !== undefined ? validateTemplateStages(body.stages) : []

  const input: CreateWorkflowTemplateInput = {
    ...(typeof body.slug === 'string' && body.slug.trim() ? { slug: body.slug.trim() } : {}),
    name,
    ...(typeof body.track === 'string' && body.track.trim() ? { track: body.track.trim() } : {}),
    ...(body.description !== undefined
      ? { description: body.description === null ? null : (body.description as string).trim() }
      : {}),
    stages,
    ...(body.isDefault !== undefined ? { isDefault: body.isDefault as boolean } : {}),
    ...(cloneFromTemplateId ? { cloneFromTemplateId } : {}),
  }

  const template = await createWorkflowTemplate({
    workspaceOwnerId: actor.workspaceOwnerId,
    input,
  })

  return NextResponse.json({ template }, { status: 201 })
})
