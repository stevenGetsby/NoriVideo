import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth, type AuthSession } from '@/lib/api-auth'
import { hasAccountPermissions, isManagementRole, normalizeAccountRole } from '@/lib/account/permissions'
import { setAccountActorContext } from '@/lib/account/request-context'
import { getWorkspaceActor, isProjectHiddenFromActor } from '@/lib/collaboration/access'
import { refineWorkflowSkillWithAi } from '@/lib/batch-workflow/executor'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function assertWorkflowAdmin(session: AuthSession): void {
  const role = normalizeAccountRole(session.user.role)
  if (!isManagementRole(role) || !hasAccountPermissions(session.user, ['admin'])) {
    throw new ApiError('FORBIDDEN', {
      message: '仅管理员可使用 AI Skill 优化调优功能。',
    })
  }
}

export const POST = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  assertWorkflowAdmin(authResult.session)
  const actor = getWorkspaceActor(authResult.session)
  setAccountActorContext(actor.actorId, actor.workspaceOwnerId)

  const body = await request.json().catch(() => null)
  if (!isPlainObject(body)) {
    throw new ApiError('INVALID_PARAMS', { message: '请求体必须为有效的 JSON 对象。' })
  }

  const skillId = typeof body.skillId === 'string' ? body.skillId.trim() : ''
  if (!skillId) {
    throw new ApiError('INVALID_PARAMS', { message: '缺少目标 Skill 标识（skillId）。' })
  }

  const feedback = typeof body.feedback === 'string' ? body.feedback.trim() : ''
  if (!feedback) {
    throw new ApiError('INVALID_PARAMS', { message: '请输入您希望优化 Skill 的反馈建议（feedback）。' })
  }
  if (feedback.length > 10000) {
    throw new ApiError('INVALID_PARAMS', { message: '优化反馈不能超过 10000 个字符。' })
  }

  if (body.projectId !== undefined && body.projectId !== null && typeof body.projectId !== 'string') {
    throw new ApiError('INVALID_PARAMS', { message: 'projectId 必须为字符串。' })
  }
  if (body.modelKey !== undefined && body.modelKey !== null && typeof body.modelKey !== 'string') {
    throw new ApiError('INVALID_PARAMS', { message: 'modelKey 必须为字符串或 null。' })
  }

  const projectId = typeof body.projectId === 'string' && body.projectId.trim()
    ? body.projectId.trim()
    : undefined
  if (projectId && await isProjectHiddenFromActor(actor, projectId)) {
    throw new ApiError('FORBIDDEN', { message: '当前账号无权访问指定的关联作品。' })
  }

  const modelKey = typeof body.modelKey === 'string' && body.modelKey.trim()
    ? body.modelKey.trim()
    : null

  const proposal = await refineWorkflowSkillWithAi({
    workspaceOwnerId: actor.workspaceOwnerId,
    actorId: actor.actorId,
    skillId,
    feedback,
    ...(body.sampleOutput !== undefined ? { sampleOutput: body.sampleOutput } : {}),
    ...(projectId ? { projectId } : {}),
    ...(modelKey ? { modelKey } : {}),
  })

  return NextResponse.json({ proposal })
})
