import {
  PROJECT_MEMBER_PERMISSIONS,
  PROJECT_OWNER_PERMISSIONS,
  WORK_LEADER_PERMISSIONS,
  WORK_MEMBER_PERMISSIONS,
  normalizeProjectMembershipRole,
  normalizeScopePermissions,
  normalizeWorkMembershipRole,
  type ScopePermission,
} from './catalog'

export interface ScopedActor {
  actorId: string
  isManagement: boolean
  accountPermissions?: readonly string[]
}

export interface WorkMembershipGrant {
  role?: unknown
  canManage?: boolean | null
  permissions?: unknown
}

export interface ProjectMembershipGrant {
  role?: unknown
  canManageAssignments?: boolean | null
  canReviewAssignments?: boolean | null
  permissions?: unknown
}

export function effectiveWorkMemberPermissions(member?: WorkMembershipGrant | null): ScopePermission[] {
  if (!member) return []
  const assigned = normalizeScopePermissions(member.permissions)
  if (assigned) return assigned
  if (member.canManage === true || normalizeWorkMembershipRole(member.role) === 'leader') {
    return [...WORK_LEADER_PERMISSIONS]
  }
  return [...WORK_MEMBER_PERMISSIONS]
}

export function effectiveProjectMemberPermissions(member?: ProjectMembershipGrant | null): ScopePermission[] {
  if (!member) return []
  const assigned = normalizeScopePermissions(member.permissions)
  if (assigned) return assigned
  if (normalizeProjectMembershipRole(member.role) === 'owner') return [...PROJECT_OWNER_PERMISSIONS]
  const legacy = new Set<ScopePermission>(PROJECT_MEMBER_PERMISSIONS)
  if (member.canManageAssignments === true) {
    legacy.add('assignmentManage')
    legacy.add('projectMemberManage')
  }
  return [...legacy]
}

export function canAccessWork(
  actor: ScopedActor,
  permission: ScopePermission,
  work: { createdById: string },
  member?: WorkMembershipGrant | null,
): boolean {
  if (actor.isManagement || work.createdById === actor.actorId) return true
  return actor.accountPermissions?.includes(permission)
    || effectiveWorkMemberPermissions(member).includes(permission)
}

export function canAccessProject(
  actor: ScopedActor,
  permission: ScopePermission,
  project: { createdById: string; work: { createdById: string } },
  workMember?: WorkMembershipGrant | null,
  projectMember?: ProjectMembershipGrant | null,
): boolean {
  if (actor.isManagement || project.work.createdById === actor.actorId) return true
  if (actor.accountPermissions?.includes(permission)
    || effectiveWorkMemberPermissions(workMember).includes(permission)
    || effectiveProjectMemberPermissions(projectMember).includes(permission)) return true
  return project.createdById === actor.actorId && PROJECT_OWNER_PERMISSIONS.includes(permission)
}
