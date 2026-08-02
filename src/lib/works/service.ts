import type { AuthSession } from '@/lib/api-auth'
import type { Prisma } from '@prisma/client'
import { ApiError } from '@/lib/api-errors'
import { prisma } from '@/lib/prisma'
import { effectiveAccountPermissions, hasAccountPermissions } from '@/lib/account/permissions'
import {
  getWorkspaceActor,
  requireActiveWorkspaceUser,
  requireProjectAssignmentManager,
  requireProjectReader,
  requireWorkManager,
  workReadScopeWhere,
  workReadWhere,
  workspaceUserWhere,
} from '@/lib/collaboration/access'
import {
  buildMemberCandidateExclusionWhere,
  buildWorkSearchWhere,
} from './filters'

const WORK_NAME_MAX_LENGTH = 50

function normalizeName(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.trim()
}

function validateWorkName(value: unknown): string {
  const name = normalizeName(value)
  if (!name) throw new ApiError('INVALID_PARAMS', { message: '请输入作品名称。' })
  if (name.length > WORK_NAME_MAX_LENGTH) {
    throw new ApiError('INVALID_PARAMS', { message: `作品名称不能超过 ${WORK_NAME_MAX_LENGTH} 个字符。` })
  }
  return name
}

function uniqueStringIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)))
}

function normalizePage(value: unknown, fallback: number, maximum = Number.MAX_SAFE_INTEGER): number {
  const number = typeof value === 'string' || typeof value === 'number' ? Number(value) : NaN
  if (!Number.isFinite(number)) return fallback
  return Math.max(1, Math.min(maximum, Math.floor(number)))
}

async function requireWorkspaceUsers(workspaceOwnerId: string, userIds: string[]) {
  if (!userIds.length) return []
  const users = await prisma.user.findMany({
    where: {
      id: { in: userIds },
      status: 'active',
      ...workspaceUserWhere(workspaceOwnerId),
    },
    select: { id: true, name: true, role: true, status: true },
  })
  if (users.length !== userIds.length) {
    throw new ApiError('INVALID_PARAMS', { message: '成员账号不存在、已停用或不属于当前工作区。' })
  }
  return users
}

const workProjectSelect = {
  id: true,
  name: true,
  description: true,
  createdAt: true,
  updatedAt: true,
  workId: true,
  createdById: true,
  collaborationMode: true,
  novelPromotionData: {
    select: {
      projectLevel: true,
      projectStyle: true,
      targetAudience: true,
      videoRatio: true,
      videoResolution: true,
      episodeDurationMode: true,
      episodeDurationValue: true,
      artStyle: true,
      importStatus: true,
      workflowMode: true,
      contentType: true,
      materialType: true,
      targetEpisodeCount: true,
      _count: {
        select: { episodes: true },
      },
    },
  },
} as const

export async function listWorks(session: AuthSession, input: {
  page?: unknown
  pageSize?: unknown
  search?: unknown
}) {
  const actor = getWorkspaceActor(session)
  const canCreateProjects = hasAccountPermissions(session.user, ['projectCreate'])
  const page = normalizePage(input.page, 1)
  const pageSize = normalizePage(input.pageSize, 20, 100)
  const search = typeof input.search === 'string' ? input.search.trim() : ''
  const accessWhere = workReadScopeWhere(session)
  const searchWhere = buildWorkSearchWhere(search)
  const where: Prisma.WorkWhereInput = searchWhere
    ? { AND: [accessWhere, searchWhere] }
    : accessWhere

  const [total, searchedTotal, rows] = await Promise.all([
    // FrameOS keeps the header count stable while filtering by search.
    prisma.work.count({ where: accessWhere }),
    searchWhere ? prisma.work.count({ where }) : Promise.resolve<number | null>(null),
    prisma.work.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        createdBy: { select: { id: true, name: true, role: true } },
        members: {
          orderBy: { createdAt: 'asc' },
          include: { user: { select: { id: true, name: true, role: true, status: true } } },
        },
        projects: {
          orderBy: { updatedAt: 'desc' },
          select: workProjectSelect,
        },
        _count: { select: { projects: true } },
      },
    }),
  ])
  const matchedTotal = searchedTotal ?? total

  const works = rows.map((work) => {
    const canManage = actor.isManagement
    const memberRows = work.members.map((member) => ({
      userId: member.userId,
      name: member.user.name,
      role: member.role,
      canManage: member.canManage,
      disabled: member.user.status !== 'active',
      isCreator: member.userId === work.createdById,
      canRemove: member.userId !== work.createdById,
    }))
    if (!memberRows.some((member) => member.userId === work.createdById)) {
      memberRows.unshift({
        userId: work.createdBy.id,
        name: work.createdBy.name,
        role: 'creator',
        canManage: true,
        disabled: false,
        isCreator: true,
        canRemove: false,
      })
    }
    return {
      id: work.id,
      name: work.name,
      createdAt: work.createdAt,
      updatedAt: work.updatedAt,
      createdById: work.createdById,
      canManage,
      canCreateProjects,
      canDelete: canManage && work._count.projects === 0,
      projectCount: work._count.projects,
      members: canManage ? memberRows : [],
      projects: work.projects.map((project) => {
        const canManageProject = actor.isManagement
        return {
          ...project,
          canManage: canManageProject,
          canMove: canManageProject,
          canManageMembers: canManageProject,
        }
      }),
    }
  })

  return {
    works,
    unassignedProjects: [],
    pagination: {
      page,
      pageSize,
      total,
      matchedTotal,
      totalPages: Math.ceil(matchedTotal / pageSize),
    },
  }
}

export async function createWork(session: AuthSession, input: {
  name?: unknown
  memberUserIds?: unknown
}) {
  const actor = getWorkspaceActor(session)
  const name = validateWorkName(input.name)
  const memberUserIds = uniqueStringIds(input.memberUserIds)
  await requireWorkspaceUsers(actor.workspaceOwnerId, memberUserIds)

  const allMembers = Array.from(new Set([actor.actorId, ...memberUserIds]))
  return prisma.$transaction(async (tx) => tx.work.create({
    data: {
      workspaceOwnerId: actor.workspaceOwnerId,
      createdById: actor.actorId,
      name,
      members: {
        create: allMembers.map((userId) => ({
          userId,
          role: userId === actor.actorId ? 'manager' : 'member',
          canManage: userId === actor.actorId,
        })),
      },
    },
    select: {
      id: true,
      name: true,
      createdAt: true,
      updatedAt: true,
      createdById: true,
    },
  }))
}

export async function updateWork(session: AuthSession, workId: string, input: {
  name?: unknown
}) {
  await requireWorkManager(session, workId)
  const name = validateWorkName(input.name)
  return prisma.work.update({
    where: { id: workId },
    data: { name },
    select: {
      id: true,
      name: true,
      createdAt: true,
      updatedAt: true,
      createdById: true,
    },
  })
}

export async function deleteWork(session: AuthSession, workId: string) {
  const { work } = await requireWorkManager(session, workId)
  if (work._count.projects > 0) {
    throw new ApiError('CONFLICT', { message: '作品下仍有项目，请先移动或删除项目。' })
  }
  // Re-assert emptiness in the delete predicate. A project may be created or
  // moved into the work after the permission/count read; relying only on the
  // earlier count would otherwise surface a raw foreign-key failure.
  const deleted = await prisma.work.deleteMany({
    where: {
      id: workId,
      projects: { none: {} },
    },
  })
  if (deleted.count !== 1) {
    throw new ApiError('CONFLICT', {
      message: '作品内容已变化，请刷新后确认作品为空再删除。',
    })
  }
}

export async function moveProjects(session: AuthSession, input: {
  projectIds?: unknown
  targetWorkId?: unknown
}) {
  const actor = getWorkspaceActor(session)
  const projectIds = uniqueStringIds(input.projectIds)
  const targetWorkId = typeof input.targetWorkId === 'string' ? input.targetWorkId.trim() : ''
  if (!projectIds.length || !targetWorkId) {
    throw new ApiError('INVALID_PARAMS', { message: '请选择项目和目标作品。' })
  }
  await requireWorkManager(session, targetWorkId)

  const projects = await prisma.project.findMany({
    where: {
      id: { in: projectIds },
      userId: actor.workspaceOwnerId,
    },
    include: {
      work: {
        include: {
          members: {
            where: { userId: actor.actorId },
            select: { role: true, canManage: true },
            take: 1,
          },
        },
      },
      members: {
        where: { userId: actor.actorId },
        select: { canManageAssignments: true },
        take: 1,
      },
    },
  })
  if (projects.length !== projectIds.length) {
    throw new ApiError('NOT_FOUND', { message: '部分项目不存在或不属于当前工作区。' })
  }
  const unauthorized = projects.some((project) => {
    if (actor.isManagement || project.createdById === actor.actorId) return false
    const workMember = project.work.members[0]
    const projectMember = project.members[0]
    return project.work.createdById !== actor.actorId
      && workMember?.canManage !== true
      && workMember?.role !== 'manager'
      && projectMember?.canManageAssignments !== true
  })
  if (unauthorized) {
    throw new ApiError('FORBIDDEN', { message: '当前账号没有移动部分项目的权限。' })
  }

  await prisma.$transaction(async (tx) => {
    // Claim rows against the source work observed during the permission check.
    // Without this predicate two concurrent moves can both report success and
    // the later transaction silently overwrites the earlier destination.
    const projectsBySourceWork = new Map<string, string[]>()
    for (const project of projects) {
      const ids = projectsBySourceWork.get(project.workId) || []
      ids.push(project.id)
      projectsBySourceWork.set(project.workId, ids)
    }
    for (const [sourceWorkId, sourceProjectIds] of projectsBySourceWork) {
      const result = await tx.project.updateMany({
        where: {
          id: { in: sourceProjectIds },
          userId: actor.workspaceOwnerId,
          workId: sourceWorkId,
        },
        data: { workId: targetWorkId },
      })
      if (result.count !== sourceProjectIds.length) {
        throw new ApiError('CONFLICT', { message: '项目已被移动，请刷新后重试。' })
      }
    }
  })
  return { moved: projectIds.length, targetWorkId }
}

export async function listMemberCandidates(session: AuthSession, input: {
  workId?: string
  projectId?: string
  keyword?: unknown
  page?: unknown
  pageSize?: unknown
  limit?: unknown
}) {
  const actor = getWorkspaceActor(session)
  let creatorId: string | null = null
  if (input.workId) {
    const { work } = await requireWorkManager(session, input.workId)
    creatorId = work.createdById
  }
  if (input.projectId) {
    const { project } = await requireProjectAssignmentManager(session, input.projectId)
    creatorId = project.createdById
  }
  const keyword = typeof input.keyword === 'string' ? input.keyword.trim() : ''
  const page = normalizePage(input.page, 1)
  const pageSize = normalizePage(input.pageSize ?? input.limit, 20, 100)
  const where: Prisma.UserWhereInput = {
    status: 'active',
    ...workspaceUserWhere(actor.workspaceOwnerId),
    ...(keyword ? { name: { contains: keyword } } : {}),
    ...buildMemberCandidateExclusionWhere({
      actorId: actor.actorId,
      creatorId,
      workId: input.workId,
      projectId: input.projectId,
    }),
  }
  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: { id: true, name: true, role: true, roleLabel: true, permissions: true, status: true },
    }),
  ])
  return {
    candidates: users.map((user) => ({
      userId: user.id,
      name: user.name,
      role: user.role,
      roleLabel: user.roleLabel,
      permissions: effectiveAccountPermissions(user.role, user.permissions),
      status: user.status,
    })),
    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  }
}

export async function listWorkMembers(session: AuthSession, workId: string) {
  const { work } = await requireWorkManagerOrReader(session, workId)
  const members = await prisma.workMember.findMany({
    where: { workId },
    orderBy: { createdAt: 'asc' },
    include: { user: { select: { id: true, name: true, role: true, roleLabel: true, status: true } } },
  })
  const items = members.map((member) => ({
    userId: member.userId,
    name: member.user.name,
    accountRole: member.user.role,
    roleLabel: member.user.roleLabel,
    status: member.user.status,
    role: member.role,
    canManage: member.canManage,
    isCreator: member.userId === work.createdById,
    canRemove: member.userId !== work.createdById,
  }))
  if (!items.some((member) => member.userId === work.createdById)) {
    const creator = await prisma.user.findUnique({
      where: { id: work.createdById },
      select: { id: true, name: true, role: true, roleLabel: true, status: true },
    })
    if (creator) items.unshift({
      userId: creator.id,
      name: creator.name,
      accountRole: creator.role,
      roleLabel: creator.roleLabel,
      status: creator.status,
      role: 'creator',
      canManage: true,
      isCreator: true,
      canRemove: false,
    })
  }
  return items
}

async function requireWorkManagerOrReader(session: AuthSession, workId: string) {
  const actor = getWorkspaceActor(session)
  const work = await prisma.work.findFirst({
    where: workReadWhere(session, workId),
    select: { id: true, createdById: true },
  })
  if (!work) throw new ApiError('NOT_FOUND', { message: '作品不存在。' })
  return { actor, work }
}

export async function addWorkMember(session: AuthSession, workId: string, userId: string) {
  const { actor } = await requireWorkManager(session, workId)
  await requireActiveWorkspaceUser(actor.workspaceOwnerId, userId)
  return prisma.workMember.upsert({
    where: { workId_userId: { workId, userId } },
    update: {},
    create: { workId, userId },
    include: { user: { select: { id: true, name: true, role: true, status: true } } },
  })
}

export async function removeWorkMember(session: AuthSession, workId: string, userId: string) {
  const { work } = await requireWorkManager(session, workId)
  if (userId === work.createdById) {
    throw new ApiError('CONFLICT', { message: '不能移除作品创建者。' })
  }
  await prisma.workMember.deleteMany({ where: { workId, userId } })
}

export async function listProjectMembers(session: AuthSession, projectId: string) {
  const actor = getWorkspaceActor(session)
  await requireProjectReader(session, projectId)
  const project = await prisma.project.findFirst({
    where: { id: projectId, userId: actor.workspaceOwnerId },
    select: {
      id: true,
      createdById: true,
      createdBy: { select: { id: true, name: true, role: true, roleLabel: true, status: true } },
    },
  })
  if (!project) throw new ApiError('NOT_FOUND', { message: '项目不存在。' })
  const members = await prisma.projectMember.findMany({
    where: { projectId },
    orderBy: { createdAt: 'asc' },
    include: { user: { select: { id: true, name: true, role: true, roleLabel: true, status: true } } },
  })
  const items = members.map((member) => ({
    userId: member.userId,
    name: member.user.name,
    role: member.user.role,
    roleLabel: member.user.roleLabel,
    status: member.user.status,
    canManageAssignments: member.canManageAssignments,
    canReviewAssignments: member.canReviewAssignments,
    isCreator: member.userId === project.createdById,
    canRemove: member.userId !== project.createdById,
  }))
  if (!items.some((member) => member.userId === project.createdById)) {
    items.unshift({
      userId: project.createdBy.id,
      name: project.createdBy.name,
      role: project.createdBy.role,
      roleLabel: project.createdBy.roleLabel,
      status: project.createdBy.status,
      canManageAssignments: true,
      canReviewAssignments: true,
      isCreator: true,
      canRemove: false,
    })
  }
  return items
}

export async function addProjectMember(session: AuthSession, projectId: string, userId: string) {
  const { actor } = await requireProjectAssignmentManager(session, projectId)
  await requireActiveWorkspaceUser(actor.workspaceOwnerId, userId)
  return prisma.projectMember.upsert({
    where: { projectId_userId: { projectId, userId } },
    update: {},
    create: { projectId, userId },
    include: { user: { select: { id: true, name: true, role: true, status: true } } },
  })
}

export async function removeProjectMember(session: AuthSession, projectId: string, userId: string) {
  const { project } = await requireProjectAssignmentManager(session, projectId)
  if (userId === project.createdById) {
    throw new ApiError('CONFLICT', { message: '不能移除项目创建者。' })
  }
  await prisma.projectMember.deleteMany({ where: { projectId, userId } })
}
