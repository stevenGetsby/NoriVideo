import type { AuthSession } from '@/lib/api-auth'
import type { Prisma } from '@prisma/client'
import { ApiError } from '@/lib/api-errors'
import { effectiveAccountPermissions, isManagementRole } from '@/lib/account/permissions'
import { canAccessProject, canAccessWork, type ScopedActor } from '@/lib/permissions/resolve'
import { projectMembershipGrantsReview } from '@/lib/collaboration/assignment-policy'
import { prisma } from '@/lib/prisma'

export interface WorkspaceActor extends Omit<ScopedActor, 'accountPermissions'> {
  accountPermissions?: readonly string[]
  workspaceOwnerId: string
  role: string
}

export function getWorkspaceActor(session: AuthSession): WorkspaceActor {
  const actorId = session.user.actorId || session.user.id
  const workspaceOwnerId = session.user.workspaceOwnerId || session.user.id
  return {
    workspaceOwnerId,
    actorId,
    isManagement: isManagementRole(session.user.role) || actorId === workspaceOwnerId,
    accountPermissions: effectiveAccountPermissions(session.user.role, session.user.permissions),
    role: session.user.role || 'reviewer',
  }
}

/**
 * 作品 (Project row) participation for a subaccount. Management accounts see
 * the whole workspace; everyone else only sees 作品 they created, were invited
 * to, were assigned a stage of, or that sit in a 项目 they lead.
 */
export function workMemberManagerWhere(actorId: string): Prisma.WorkMemberWhereInput {
  return {
    userId: actorId,
    OR: [
      { canManage: true },
      { role: { in: ['manager', 'leader'] } },
      { permissions: { array_contains: ['projectManage'] } },
    ],
  }
}

export function projectParticipantWhere(actorId: string): Prisma.ProjectWhereInput {
  return {
    OR: [
      { createdById: actorId },
      { members: { some: { userId: actorId } } },
      { workflowAssignments: { some: { assigneeUserId: actorId } } },
      { work: { createdById: actorId } },
      { work: { members: { some: workMemberManagerWhere(actorId) } } },
    ],
  }
}

export function canActorSeeProject(actor: WorkspaceActor, project: {
  createdById: string
  isMember: boolean
  isAssignee: boolean
  workCreatedById: string
  isWorkManager: boolean
}): boolean {
  if (actor.isManagement) return true
  return project.createdById === actor.actorId
    || project.isMember
    || project.isAssignee
    || project.workCreatedById === actor.actorId
    || project.isWorkManager
}

export function visibleProjectsWhere(session: AuthSession): Prisma.ProjectWhereInput {
  const actor = getWorkspaceActor(session)
  return actor.isManagement ? {} : projectParticipantWhere(actor.actorId)
}

export function projectReadScopeWhere(session: AuthSession): Prisma.ProjectWhereInput {
  const actor = getWorkspaceActor(session)
  return {
    userId: actor.workspaceOwnerId,
    deletedAt: null,
    ...visibleProjectsWhere(session),
  }
}

export function workReadScopeWhere(session: AuthSession): Prisma.WorkWhereInput {
  const actor = getWorkspaceActor(session)
  if (actor.isManagement) return { workspaceOwnerId: actor.workspaceOwnerId, deletedAt: null }
  // A 项目 is visible to its members and to anyone who can see one of its 作品,
  // but the 作品 list inside it is still filtered by projectParticipantWhere.
  return {
    workspaceOwnerId: actor.workspaceOwnerId,
    deletedAt: null,
    OR: [
      { createdById: actor.actorId },
      { members: { some: { userId: actor.actorId } } },
      { projects: { some: { deletedAt: null, ...projectParticipantWhere(actor.actorId) } } },
    ],
  }
}

export function workReadWhere(session: AuthSession, workId: string): Prisma.WorkWhereInput {
  return {
    ...workReadScopeWhere(session),
    id: workId,
  }
}

export function projectReadWhere(session: AuthSession, projectId: string): Prisma.ProjectWhereInput {
  return {
    ...projectReadScopeWhere(session),
    id: projectId,
  }
}

export function workspaceUserWhere(workspaceOwnerId: string) {
  return {
    OR: [
      { id: workspaceOwnerId },
      { workspaceOwnerId },
    ],
  }
}

export async function requireActiveWorkspaceUser(workspaceOwnerId: string, userId: string) {
  const user = await prisma.user.findFirst({
    where: {
      id: userId,
      status: 'active',
      ...workspaceUserWhere(workspaceOwnerId),
    },
    select: {
      id: true,
      name: true,
      role: true,
      roleLabel: true,
      permissions: true,
      status: true,
      workspaceOwnerId: true,
    },
  })
  if (!user) {
    throw new ApiError('INVALID_PARAMS', { message: '所选账号不存在、已停用或不属于当前工作区。' })
  }
  return user
}

/**
 * True only when the id is a 作品 in the actor's workspace that the actor may
 * not see. Unknown ids return false so routes keep their own 404 handling and
 * non-作品 ids (global asset hub, account material scopes) pass through.
 */
export async function isProjectHiddenFromActor(actor: WorkspaceActor, projectId: string): Promise<boolean> {
  if (actor.isManagement) return false
  const project = await prisma.project.findFirst({
    where: { id: projectId, userId: actor.workspaceOwnerId },
    select: {
      createdById: true,
      members: { where: { userId: actor.actorId }, select: { id: true }, take: 1 },
      workflowAssignments: { where: { assigneeUserId: actor.actorId }, select: { uuid: true }, take: 1 },
      work: {
        select: {
          createdById: true,
          members: {
            where: workMemberManagerWhere(actor.actorId),
            select: { id: true },
            take: 1,
          },
        },
      },
    },
  })
  if (!project) return false
  return !canActorSeeProject(actor, {
    createdById: project.createdById,
    isMember: project.members.length > 0,
    isAssignee: project.workflowAssignments.length > 0,
    workCreatedById: project.work.createdById,
    isWorkManager: project.work.members.length > 0,
  })
}

/** Workspace 作品 ids among `projectIds` that the actor may not see. */
export async function findHiddenProjectIds(session: AuthSession, projectIds: readonly string[]): Promise<Set<string>> {
  const actor = getWorkspaceActor(session)
  const ids = Array.from(new Set(projectIds.filter(Boolean)))
  if (actor.isManagement || ids.length === 0) return new Set()
  const hidden = await prisma.project.findMany({
    where: {
      id: { in: ids },
      userId: actor.workspaceOwnerId,
      NOT: projectParticipantWhere(actor.actorId),
    },
    select: { id: true },
  })
  return new Set(hidden.map((project) => project.id))
}

export async function getWorkAccess(session: AuthSession, workId: string) {
  const actor = getWorkspaceActor(session)
  const work = await prisma.work.findFirst({
    where: workReadWhere(session, workId),
    include: {
      projects: {
        where: { deletedAt: null },
        select: { id: true },
      },
      members: {
        where: { userId: actor.actorId },
        select: { role: true, canManage: true, permissions: true },
        take: 1,
      },
    },
  })
  if (!work) throw new ApiError('NOT_FOUND', { message: '项目不存在。' })
  const membership = work.members[0]
  const canManage = canAccessWork(actor, 'workManage', work, membership)
  const canManageMembers = canAccessWork(actor, 'workMemberManage', work, membership)
  const canDelete = canAccessWork(actor, 'workDelete', work, membership)
  const canCreateProjects = canAccessWork(actor, 'projectCreate', work, membership)
  return { actor, work, canManage, canManageMembers, canDelete, canCreateProjects }
}

export async function requireWorkPermission(
  session: AuthSession,
  workId: string,
  permission: 'workManage' | 'workMemberManage' | 'workDelete',
) {
  const access = await getWorkAccess(session, workId)
  const allowed = permission === 'workManage'
    ? access.canManage
    : permission === 'workMemberManage'
      ? access.canManageMembers
      : access.canDelete
  if (!allowed) {
    throw new ApiError('FORBIDDEN', { message: '当前账号没有管理该项目的权限。' })
  }
  return access
}

export async function requireWorkManager(session: AuthSession, workId: string) {
  return requireWorkPermission(session, workId, 'workManage')
}

export async function requireWorkMemberManager(session: AuthSession, workId: string) {
  return requireWorkPermission(session, workId, 'workMemberManage')
}

/**
 * Project creation is an independently assignable functional permission.
 * It never grants work rename/member/delete privileges, so it must not reuse
 * `requireWorkManager` or inflate `canManage` on the returned work object.
 */
export async function requireWorkProjectCreator(session: AuthSession, workId: string) {
  const access = await getWorkAccess(session, workId)
  if (!access.canCreateProjects) {
    throw new ApiError('FORBIDDEN', { message: '当前账号没有在该项目中新建作品的权限。' })
  }
  return access
}

export async function getProjectCollaborationAccess(session: AuthSession, projectId: string) {
  const actor = getWorkspaceActor(session)
  const project = await prisma.project.findFirst({
    where: projectReadWhere(session, projectId),
    include: {
      work: {
        include: {
          members: {
            where: { userId: actor.actorId },
            select: { canManage: true, role: true, permissions: true },
            take: 1,
          },
        },
      },
      members: {
        where: { userId: actor.actorId },
        select: {
          canManageAssignments: true,
          canReviewAssignments: true,
          role: true,
          permissions: true,
        },
        take: 1,
      },
    },
  })
  if (!project) throw new ApiError('NOT_FOUND', { message: '作品不存在。' })

  const workMembership = project.work.members[0]
  const projectMembership = project.members[0]
  // projectReadWhere already restricts subaccounts to 作品 they participate in.
  const canRead = true
  const canManageAssignments = canAccessProject(
    actor, 'assignmentManage', project, workMembership, projectMembership,
  )
  const canReviewAssignments = projectMembershipGrantsReview({
    membership: projectMembership,
    accountRole: actor.role,
  }) || canAccessProject(
    actor, 'assignmentReview', project, workMembership, projectMembership,
  )
  const canManageProject = canAccessProject(
    actor, 'projectManage', project, workMembership, projectMembership,
  )
  const canManageMembers = canAccessProject(
    actor, 'projectMemberManage', project, workMembership, projectMembership,
  )
  const canDelete = canAccessProject(
    actor, 'projectDelete', project, workMembership, projectMembership,
  )
  const canMove = canAccessProject(
    actor, 'projectMove', project, workMembership, projectMembership,
  )

  return {
    actor,
    project,
    canRead,
    canManageProject,
    canManageMembers,
    canDelete,
    canMove,
    canManageAssignments,
    canReviewAssignments,
  }
}

export async function requireProjectReader(session: AuthSession, projectId: string) {
  const access = await getProjectCollaborationAccess(session, projectId)
  if (!access.canRead) {
    throw new ApiError('FORBIDDEN', { message: '当前账号没有访问该作品的权限。' })
  }
  return access
}

export async function requireProjectManager(session: AuthSession, projectId: string) {
  const access = await getProjectCollaborationAccess(session, projectId)
  if (!access.canManageProject) {
    throw new ApiError('FORBIDDEN', { message: '当前账号没有管理该作品的权限。' })
  }
  return access
}

export async function requireProjectMemberManager(session: AuthSession, projectId: string) {
  const access = await getProjectCollaborationAccess(session, projectId)
  if (!access.canManageMembers) {
    throw new ApiError('FORBIDDEN', { message: '当前账号没有管理该作品成员的权限。' })
  }
  return access
}

export async function requireProjectAssignmentManager(session: AuthSession, projectId: string) {
  const access = await getProjectCollaborationAccess(session, projectId)
  if (!access.canManageAssignments) {
    throw new ApiError('FORBIDDEN', { message: '当前账号没有分配该作品任务的权限。' })
  }
  return access
}

export async function requireProjectAssignmentReviewer(session: AuthSession, projectId: string) {
  const access = await getProjectCollaborationAccess(session, projectId)
  if (!access.canReviewAssignments) {
    throw new ApiError('FORBIDDEN', { message: '当前账号没有审核该作品任务的权限。' })
  }
  return access
}
