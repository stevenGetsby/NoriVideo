import { ApiError } from '@/lib/api-errors'
import type { AssignmentStage } from '@/lib/collaboration/assignment-policy'

export const PROJECT_ROLE_ASSIGNEE_ROLES = ['writer', 'asset', 'storyboard'] as const
export type ProjectRoleAssigneeRole = (typeof PROJECT_ROLE_ASSIGNEE_ROLES)[number]

export type ProjectRoleAssignees = Record<ProjectRoleAssigneeRole, string | null>

const ROLE_FIELD: Record<ProjectRoleAssigneeRole, string> = {
  writer: 'writerAssigneeUserId',
  asset: 'assetAssigneeUserId',
  storyboard: 'storyboardAssigneeUserId',
}

const ROLE_ALIASES: Record<ProjectRoleAssigneeRole, readonly string[]> = {
  writer: ['writerAssigneeUserId', 'writer_assignee_user_id'],
  asset: ['assetAssigneeUserId', 'asset_assignee_user_id'],
  storyboard: ['storyboardAssigneeUserId', 'storyboard_assignee_user_id'],
}

export const PROJECT_STAGE_ASSIGNEE_ROLE: Record<AssignmentStage, ProjectRoleAssigneeRole> = {
  script: 'writer',
  asset: 'asset',
  storyboard: 'storyboard',
  video: 'storyboard',
}

function readFirstText(body: Record<string, unknown>, fields: readonly string[]): string | null {
  for (const field of fields) {
    const value = body[field]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

export function readProjectRoleAssignees(
  body: Record<string, unknown>,
  collaborationMode: 'solo' | 'team',
): ProjectRoleAssignees {
  if (collaborationMode === 'solo') {
    return { writer: null, asset: null, storyboard: null }
  }

  const assignees: ProjectRoleAssignees = {
    writer: readFirstText(body, ROLE_ALIASES.writer),
    asset: readFirstText(body, ROLE_ALIASES.asset),
    storyboard: readFirstText(body, ROLE_ALIASES.storyboard),
  }
  const selected = uniqueProjectRoleAssigneeIds(assignees)
  if (selected.length === 0) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'PROJECT_ASSIGNEE_REQUIRED',
      field: 'projectAssignees',
      message: '任务分工模式至少需要选择一名功能区负责人。',
    })
  }
  return assignees
}

export function uniqueProjectRoleAssigneeIds(assignees: ProjectRoleAssignees): string[] {
  return Array.from(new Set(Object.values(assignees).filter((value): value is string => Boolean(value))))
}

export function projectAssigneeForStage(
  assignees: ProjectRoleAssignees,
  stage: AssignmentStage,
): string | null {
  return assignees[PROJECT_STAGE_ASSIGNEE_ROLE[stage]]
}

export function assertProjectRoleAssignee(
  assignees: ProjectRoleAssignees,
  user: { id: string; role: string; permissions?: unknown; status: string } | null | undefined,
  expectedRole: ProjectRoleAssigneeRole,
): void {
  const userId = assignees[expectedRole]
  if (!userId) return
  if (!user || user.id !== userId || user.status !== 'active') {
    throw new ApiError('INVALID_PARAMS', {
      code: 'PROJECT_ASSIGNEE_UNAVAILABLE',
      field: ROLE_FIELD[expectedRole],
      message: '所选子账号不存在、已停用或不属于当前管理账号。',
    })
  }
}
