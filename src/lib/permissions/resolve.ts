import {
  PROJECT_MEMBER_PERMISSIONS,
  PROJECT_OWNER_PERMISSIONS,
  WORK_MEMBER_PERMISSIONS,
  normalizeProjectMembershipRole,
  normalizeScopePermissions,
  type ScopePermission,
} from './catalog'

export interface ScopedActor {
  actorId: string
  isManagement: boolean
  projectLeader?: boolean
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
  const assigned = normalizeScopePermissions(member.permissions)?.filter(
    (permission) => permission === 'projectCreate' || permission === 'projectManage',
  ) ?? []
  return Array.from(new Set<ScopePermission>([...WORK_MEMBER_PERMISSIONS, ...assigned]))
}

export function effectiveProjectMemberPermissions(member?: ProjectMembershipGrant | null): ScopePermission[] {
  if (!member) return []
  const assigned = normalizeScopePermissions(member.permissions)?.filter((permission) => permission === 'projectManage' || permission === 'assignmentReview') ?? null
  if (assigned) return Array.from(new Set<ScopePermission>([...PROJECT_MEMBER_PERMISSIONS, ...assigned]))
  if (normalizeProjectMembershipRole(member.role) === 'owner') return [...PROJECT_OWNER_PERMISSIONS]
  const legacy = new Set<ScopePermission>(PROJECT_MEMBER_PERMISSIONS)
  if (member.canManageAssignments === true) {
    legacy.add('assignmentReview')
  }
  return [...legacy]
}

export function canAccessWork(
  actor: ScopedActor,
  permission: ScopePermission,
  _work: { createdById: string },
  member?: WorkMembershipGrant | null,
): boolean {
  if (actor.isManagement || actor.projectLeader === true) return true
  return effectiveWorkMemberPermissions(member).includes(permission)
}

export function canAccessProject(
  actor: ScopedActor,
  permission: ScopePermission,
  project: { createdById: string; work: { createdById: string } },
  workMember?: WorkMembershipGrant | null,
  projectMember?: ProjectMembershipGrant | null,
): boolean {
  if (actor.isManagement) return true
  if (actor.projectLeader === true) return true
  if (effectiveWorkMemberPermissions(workMember).includes(permission)
    || effectiveProjectMemberPermissions(projectMember).includes(permission)) return true
  return project.createdById === actor.actorId && PROJECT_OWNER_PERMISSIONS.includes(permission)
}
