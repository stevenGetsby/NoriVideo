export const SCOPE_PERMISSION_KEYS = [
  'projectCreate',
  'workManage',
  'workMemberManage',
  'workDelete',
  'projectManage',
  'projectMemberManage',
  'projectDelete',
  'projectMove',
  'assignmentManage',
  'assignmentReview',
] as const

export type ScopePermission = typeof SCOPE_PERMISSION_KEYS[number]
export type WorkMembershipRole = 'leader' | 'member'
export type ProjectMembershipRole = 'owner' | 'member'

export const WORK_LEADER_PERMISSIONS: readonly ScopePermission[] = [...SCOPE_PERMISSION_KEYS]
export const WORK_MEMBER_PERMISSIONS: readonly ScopePermission[] = ['projectCreate']
export const PROJECT_MEMBER_PERMISSIONS: readonly ScopePermission[] = []
export const PROJECT_OWNER_PERMISSIONS: readonly ScopePermission[] = [
  'projectManage',
  'projectDelete',
  'projectMove',
  'projectMemberManage',
  'assignmentManage',
  'assignmentReview',
]

export const SCOPE_PERMISSION_DEFINITIONS: ReadonlyArray<{
  key: ScopePermission
  label: string
  description: string
}> = [
  { key: 'projectCreate', label: '新建作品', description: '在该项目内创建作品，创建者负责自己的作品' },
  { key: 'workManage', label: '管理项目', description: '修改项目名称及项目级设置' },
  { key: 'workMemberManage', label: '管理项目成员', description: '分配成员并设置该项目内的角色与权限' },
  { key: 'workDelete', label: '删除项目', description: '将项目及其中作品移入回收站' },
  { key: 'projectManage', label: '管理全部作品', description: '管理该项目内所有成员创建的作品' },
  { key: 'projectMemberManage', label: '管理作品成员', description: '调整作品参与者及任务权限' },
  { key: 'projectDelete', label: '删除全部作品', description: '将该项目内任意作品移入回收站' },
  { key: 'projectMove', label: '移动全部作品', description: '在该项目内移动任意作品' },
  { key: 'assignmentManage', label: '分配任务', description: '为作品分配制作任务' },
  { key: 'assignmentReview', label: '审核任务', description: '审核该作品的任务交付' },
]

export function isScopePermission(value: unknown): value is ScopePermission {
  return typeof value === 'string' && SCOPE_PERMISSION_KEYS.includes(value as ScopePermission)
}

export function normalizeScopePermissions(value: unknown): ScopePermission[] | null {
  if (!Array.isArray(value)) return null
  const requested = new Set(value.filter(isScopePermission))
  return SCOPE_PERMISSION_KEYS.filter((permission) => requested.has(permission))
}

export function normalizeWorkMembershipRole(value: unknown): WorkMembershipRole {
  return value === 'leader' || value === 'manager' || value === 'creator' ? 'leader' : 'member'
}

export function normalizeProjectMembershipRole(value: unknown): ProjectMembershipRole {
  return value === 'owner' ? 'owner' : 'member'
}

export function isWorkMembershipRole(value: unknown): value is WorkMembershipRole {
  return value === 'leader' || value === 'member'
}

export function isProjectMembershipRole(value: unknown): value is ProjectMembershipRole {
  return value === 'owner' || value === 'member'
}
