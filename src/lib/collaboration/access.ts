import type { AuthSession } from '@/lib/api-auth'
import type { Prisma } from '@prisma/client'
import { ApiError } from '@/lib/api-errors'
import { hasAccountPermissions, isManagementRole } from '@/lib/account/permissions'
import { projectMembershipGrantsReview, resolveAssignmentCapabilities } from '@/lib/collaboration/assignment-policy'
import { prisma } from '@/lib/prisma'

export interface WorkspaceActor {
  workspaceOwnerId: string
  actorId: string
  isManagement: boolean
  role: string
}

export function getWorkspaceActor(session: AuthSession): WorkspaceActor {
  const actorId = session.user.actorId || session.user.id
  const workspaceOwnerId = session.user.workspaceOwnerId || session.user.id
  return {
    workspaceOwnerId,
    actorId,
    isManagement: isManagementRole(session.user.role) || actorId === workspaceOwnerId,
    role: session.user.role || 'reviewer',
  }
}

export function projectReadScopeWhere(session: AuthSession): Prisma.ProjectWhereInput {
  const actor = getWorkspaceActor(session)
  // Project visibility belongs to the workspace, not to an explicit project
  // membership. A validated subaccount resolves to its management account via
  // workspaceOwnerId, so every direct subaccount can read the same projects.
  // Project membership remains relevant only to assignment/review capabilities.
  return {
    userId: actor.workspaceOwnerId,
  }
}

export function workReadScopeWhere(session: AuthSession): Prisma.WorkWhereInput {
  const actor = getWorkspaceActor(session)
  return { workspaceOwnerId: actor.workspaceOwnerId }
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

export async function getWorkAccess(session: AuthSession, workId: string) {
  const actor = getWorkspaceActor(session)
  const work = await prisma.work.findFirst({
    where: {
      id: workId,
      workspaceOwnerId: actor.workspaceOwnerId,
    },
    include: {
      _count: { select: { projects: true } },
    },
  })
  if (!work) throw new ApiError('NOT_FOUND', { message: '作品不存在。' })
  // Subaccounts share workspace visibility but never become workspace-content
  // administrators. Work membership is retained for assignment context only.
  const canManage = actor.isManagement
  const canCreateProjects = hasAccountPermissions(session.user, ['projectCreate'])
  return { actor, work, canManage, canCreateProjects }
}

export async function requireWorkManager(session: AuthSession, workId: string) {
  const access = await getWorkAccess(session, workId)
  if (!access.canManage) {
    throw new ApiError('FORBIDDEN', { message: '当前账号没有管理该作品的权限。' })
  }
  return access
}

/**
 * Project creation is an independently assignable functional permission.
 * It never grants work rename/member/delete privileges, so it must not reuse
 * `requireWorkManager` or inflate `canManage` on the returned work object.
 */
export async function requireWorkProjectCreator(session: AuthSession, workId: string) {
  const access = await getWorkAccess(session, workId)
  if (!access.canCreateProjects) {
    throw new ApiError('FORBIDDEN', { message: '当前账号没有在该作品中新建项目的权限。' })
  }
  return access
}

export async function getProjectCollaborationAccess(session: AuthSession, projectId: string) {
  const actor = getWorkspaceActor(session)
  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      userId: actor.workspaceOwnerId,
    },
    include: {
      work: {
        include: {
          members: {
            where: { userId: actor.actorId },
            select: { canManage: true, role: true },
            take: 1,
          },
        },
      },
      members: {
        where: { userId: actor.actorId },
        select: {
          canManageAssignments: true,
          canReviewAssignments: true,
        },
        take: 1,
      },
    },
  })
  if (!project) throw new ApiError('NOT_FOUND', { message: '项目不存在。' })

  const workMembership = project.work.members[0]
  const projectMembership = project.members[0]
  // The query above already proves that this project belongs to the actor's
  // resolved workspace. Explicit membership must not gate basic visibility.
  const canRead = true
  const capabilities = resolveAssignmentCapabilities({
    actorIsManagement: actor.isManagement,
    actorIsProjectCreator: project.createdById === actor.actorId,
    actorIsWorkCreator: project.work.createdById === actor.actorId,
    workMemberCanManage: workMembership?.canManage === true,
    workMemberRole: workMembership?.role,
    projectMemberCanManage: projectMembership?.canManageAssignments === true,
    projectMemberCanReview: projectMembershipGrantsReview({
      membership: projectMembership,
      accountRole: actor.role,
    }),
  })
  const canManageAssignments = capabilities.canManage
  const canReviewAssignments = capabilities.canReview
  const canManageProject = actor.isManagement

  return {
    actor,
    project,
    canRead,
    canManageProject,
    canManageAssignments,
    canReviewAssignments,
  }
}

export async function requireProjectReader(session: AuthSession, projectId: string) {
  const access = await getProjectCollaborationAccess(session, projectId)
  if (!access.canRead) {
    throw new ApiError('FORBIDDEN', { message: '当前账号没有访问该项目的权限。' })
  }
  return access
}

export async function requireProjectManager(session: AuthSession, projectId: string) {
  const access = await getProjectCollaborationAccess(session, projectId)
  if (!access.canManageProject) {
    throw new ApiError('FORBIDDEN', { message: '当前账号没有管理该项目的权限。' })
  }
  return access
}

export async function requireProjectAssignmentManager(session: AuthSession, projectId: string) {
  const access = await getProjectCollaborationAccess(session, projectId)
  if (!access.canManageAssignments) {
    throw new ApiError('FORBIDDEN', { message: '当前账号没有分配该项目任务的权限。' })
  }
  return access
}

export async function requireProjectAssignmentReviewer(session: AuthSession, projectId: string) {
  const access = await getProjectCollaborationAccess(session, projectId)
  if (!access.canReviewAssignments) {
    throw new ApiError('FORBIDDEN', { message: '当前账号没有审核该项目任务的权限。' })
  }
  return access
}
