import type { AuthSession } from '@/lib/api-auth'
import { Prisma } from '@prisma/client'
import { ApiError } from '@/lib/api-errors'
import { prisma } from '@/lib/prisma'
import { effectiveAccountPermissions } from '@/lib/account/permissions'
import {
  getWorkspaceActor,
  requireActiveWorkspaceUser,
  requireProjectMemberManager,
  requireProjectReader,
  requireWorkManager,
  requireWorkMemberManager,
  requireWorkPermission,
  projectReadScopeWhere,
  visibleProjectsWhere,
  workReadScopeWhere,
  workReadWhere,
  workspaceUserWhere,
} from '@/lib/collaboration/access'
import {
  buildMemberCandidateExclusionWhere,
  buildWorkSearchWhere,
} from './filters'
import {
  canAccessProject,
  canAccessWork,
  effectiveProjectMemberPermissions,
  effectiveWorkMemberPermissions,
} from '@/lib/permissions/resolve'
import { productionHierarchy } from '@/lib/projects/hierarchy'
import { projectCoverImageUrl } from '@/lib/projects/project-cover-url'
import { normalizeMoveWorkInput } from './move-input'
import { PROJECT_RECYCLE_RETENTION_DAYS, PROJECT_RECYCLE_RETENTION_MS } from '@/lib/projects/recycle-bin'

const WORK_NAME_MAX_LENGTH = 50

function normalizeName(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.trim()
}

function validateWorkName(value: unknown): string {
  const name = normalizeName(value)
  if (!name) throw new ApiError('INVALID_PARAMS', { message: '请输入项目名称。' })
  if (name.length > WORK_NAME_MAX_LENGTH) {
    throw new ApiError('INVALID_PARAMS', { message: `项目名称不能超过 ${WORK_NAME_MAX_LENGTH} 个字符。` })
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

export function readWorkMemberGrant(body: Record<string, unknown>) {
  if (body.role !== undefined || body.permissions !== undefined) {
    throw new ApiError('INVALID_PARAMS', { message: '项目组长由管理员统一设置，不能通过成员角色或权限数组授予。' })
  }
  return { userId: readMemberUserId(body) }
}

export function readProjectMemberGrant(body: Record<string, unknown>) {
  if (body.role !== undefined || body.permissions !== undefined) {
    throw new ApiError('INVALID_PARAMS', { message: '项目组长由管理员统一设置，不能通过成员角色或权限数组授予。' })
  }
  return { userId: readMemberUserId(body) }
}

function readMemberUserId(body: Record<string, unknown>) {
  const userId = typeof body.userId === 'string' ? body.userId.trim() : ''
  if (!userId) throw new ApiError('INVALID_PARAMS', { message: '请选择成员账号。' })
  return userId
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
  coverImageKey: true,
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
        _count: { select: { projects: true } },
        createdBy: { select: { id: true, name: true, role: true, projectLeader: true } },
        members: {
          orderBy: { createdAt: 'asc' },
          include: { user: { select: { id: true, name: true, role: true, status: true, projectLeader: true } } },
        },
        projects: {
          where: { deletedAt: null, ...visibleProjectsWhere(session) },
          orderBy: { updatedAt: 'desc' },
          select: {
            ...workProjectSelect,
            members: {
              where: { userId: actor.actorId },
              select: { role: true, permissions: true, canManageAssignments: true, canReviewAssignments: true },
              take: 1,
            },
          },
        },
      },
    }),
  ])
  const matchedTotal = searchedTotal ?? total

  const works = rows.map((work) => {
    const workMembership = work.members.find((member) => member.userId === actor.actorId)
    const canManage = canAccessWork(actor, 'workManage', work, workMembership)
    const canManageMembers = canAccessWork(actor, 'workMemberManage', work, workMembership)
    const canDelete = canAccessWork(actor, 'workDelete', work, workMembership)
    const canCreateProjects = canAccessWork(actor, 'projectCreate', work, workMembership)
    const memberRows = work.members.map((member) => ({
      userId: member.userId,
      name: member.user.name,
      role: member.user.projectLeader ? 'leader' : 'member',
      canManage: actor.projectLeader,
      permissions: null,
      effectivePermissions: effectiveWorkMemberPermissions({ role: member.user.projectLeader ? 'leader' : 'member' }),
      disabled: member.user.status !== 'active',
      isCreator: member.userId === work.createdById,
      canRemove: member.userId !== work.createdById,
    }))
    if (!memberRows.some((member) => member.userId === work.createdById)) {
      memberRows.unshift({
        userId: work.createdBy.id,
        name: work.createdBy.name,
        role: work.createdBy.projectLeader ? 'leader' : 'member',
        canManage: false,
        permissions: null,
        effectivePermissions: effectiveWorkMemberPermissions({ role: work.createdBy.projectLeader ? 'leader' : 'member' }),
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
      canManageMembers,
      canCreateProjects,
      canDelete,
      canMoveProjects: canManage,
      projectCount: work.projects.length,
      members: canManageMembers ? memberRows : [],
      projects: work.projects.map((project) => {
        const { members: projectMembers, ...projectData } = project
        const canManageProject = canAccessProject(actor, 'projectManage', { ...project, work }, workMembership, projectMembers[0])
        const canMove = canAccessProject(actor, 'projectMove', { ...project, work }, workMembership, projectMembers[0])
        const canManageProjectMembers = canAccessProject(actor, 'projectMemberManage', { ...project, work }, workMembership, projectMembers[0])
        const canDeleteProject = actor.isManagement || project.createdById === actor.actorId
        return {
          ...projectData,
          coverImageUrl: projectCoverImageUrl(project.coverImageKey),
          canManage: canManageProject,
          canMove,
          canManageMembers: canManageProjectMembers,
          canDelete: canDeleteProject,
        }
      }),
    }
  })

  return {
    projectHierarchy: productionHierarchy(works),
    // Legacy protocol retained for existing task/asset clients.
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
  if (!actor.isManagement && !actor.projectLeader) {
    throw new ApiError('FORBIDDEN', { message: '当前账号不是项目组长，请联系管理员设置。' })
  }
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
          role: 'member',
          canManage: false,
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
  const { actor } = await requireWorkPermission(session, workId, 'workDelete')
  const deletedAt = new Date()
  return prisma.$transaction(async (tx) => {
    const work = await tx.work.findFirst({
      where: { id: workId, workspaceOwnerId: actor.workspaceOwnerId, deletedAt: null },
      select: { id: true },
    })
    if (!work) throw new ApiError('CONFLICT', { message: '项目已被删除，请刷新后重试。' })
    const recycled = await tx.project.updateMany({
      where: { workId, userId: actor.workspaceOwnerId, deletedAt: null },
      data: { deletedAt, deletedById: actor.actorId, deletedWithWork: true },
    })
    await tx.work.update({
      where: { id: workId },
      data: { deletedAt, deletedById: actor.actorId },
    })
    return {
      deletedAt: deletedAt.toISOString(),
      restoreDeadline: new Date(deletedAt.getTime() + PROJECT_RECYCLE_RETENTION_MS).toISOString(),
      recycledProjects: recycled.count,
      retentionDays: PROJECT_RECYCLE_RETENTION_DAYS,
    }
  })
}

export async function moveProjects(session: AuthSession, input: {
  workIds?: unknown
  targetProjectId?: unknown
  projectIds?: unknown
  targetWorkId?: unknown
}) {
  const actor = getWorkspaceActor(session)
  const { workIds: projectIds, targetProjectId: targetWorkId } = normalizeMoveWorkInput(input)
  await requireWorkManager(session, targetWorkId)

  const projects = await prisma.project.findMany({
    where: {
      ...projectReadScopeWhere(session),
      id: { in: projectIds },
    },
    include: {
      work: {
        include: {
          interactiveStory: { select: { id: true } },
          members: {
            where: { userId: actor.actorId },
            select: { role: true, canManage: true, permissions: true },
            take: 1,
          },
        },
      },
      members: {
        where: { userId: actor.actorId },
        select: { canManageAssignments: true, canReviewAssignments: true, role: true, permissions: true },
        take: 1,
      },
    },
  })
  if (projects.length !== projectIds.length) {
    throw new ApiError('NOT_FOUND', { message: '部分作品不存在或不属于当前工作区。' })
  }
  const unauthorized = projects.some((project) => (
    !canAccessProject(actor, 'projectMove', project, project.work.members[0], project.members[0])
  ))
  if (unauthorized) {
    throw new ApiError('FORBIDDEN', { message: '当前账号没有移动部分作品的权限。' })
  }
  const sourceStory = projects.some((project) => Boolean(project.work.interactiveStory))
  const targetStory = await prisma.interactiveStory.findUnique({
    where: { workId: targetWorkId },
    select: { id: true },
  })
  if (sourceStory !== Boolean(targetStory)) {
    throw new ApiError('CONFLICT', { message: '普通作品与影游章节不能互相移动，以免改变项目类型或破坏剧情关联。' })
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
          // A delete may commit after the read above. Recheck inside the
          // atomic update so recycled works never change their parent.
          deletedAt: null,
        },
        data: { workId: targetWorkId },
      })
      if (result.count !== sourceProjectIds.length) {
        throw new ApiError('CONFLICT', { message: '作品已被移动或删除，请刷新后重试。' })
      }
    }
  })
  return { moved: projectIds.length, targetProjectId: targetWorkId, targetWorkId }
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
    const { work } = await requireWorkMemberManager(session, input.workId)
    creatorId = work.createdById
  }
    if (input.projectId) {
    const { project } = await requireProjectMemberManager(session, input.projectId)
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
    include: { user: { select: { id: true, name: true, role: true, status: true, projectLeader: true } } },
  })
  const items = members.map((member) => ({
    userId: member.userId,
    name: member.user.name,
    accountRole: member.user.role,
    status: member.user.status,
    role: member.user.projectLeader ? 'leader' : 'member',
    effectivePermissions: effectiveWorkMemberPermissions({ role: member.user.projectLeader ? 'leader' : 'member' }),
    isCreator: member.userId === work.createdById,
    canRemove: member.userId !== work.createdById,
  }))
  if (!items.some((member) => member.userId === work.createdById)) {
    const creator = await prisma.user.findUnique({
      where: { id: work.createdById },
      select: { id: true, name: true, role: true, status: true, projectLeader: true },
    })
    if (creator) items.unshift({
      userId: creator.id,
      name: creator.name,
      accountRole: creator.role,
      status: creator.status,
      role: creator.projectLeader ? 'leader' : 'member',
      effectivePermissions: effectiveWorkMemberPermissions({ role: creator.projectLeader ? 'leader' : 'member' }),
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
  if (!work) throw new ApiError('NOT_FOUND', { message: '项目不存在。' })
  return { actor, work }
}

export async function addWorkMember(
  session: AuthSession,
  workId: string,
  input: string | { userId: string },
) {
  const grant = typeof input === 'string' ? { userId: input } : input
  const { actor } = await requireWorkMemberManager(session, workId)
  await requireActiveWorkspaceUser(actor.workspaceOwnerId, grant.userId)
  return prisma.workMember.upsert({
    where: { workId_userId: { workId, userId: grant.userId } },
    update: {},
    create: {
      workId,
      userId: grant.userId,
      role: 'member',
      canManage: false,
    },
    include: { user: { select: { id: true, name: true, role: true, status: true } } },
  })
}

export async function removeWorkMember(session: AuthSession, workId: string, userId: string) {
  const { work } = await requireWorkMemberManager(session, workId)
  if (userId === work.createdById) {
    throw new ApiError('CONFLICT', { message: '不能移除项目创建者。' })
  }
  await prisma.workMember.deleteMany({ where: { workId, userId } })
}

export async function listProjectMembers(session: AuthSession, projectId: string) {
  await requireProjectReader(session, projectId)
  const project = await prisma.project.findFirst({
    where: { ...projectReadScopeWhere(session), id: projectId },
    select: {
      id: true,
      createdById: true,
      createdBy: { select: { id: true, name: true, role: true, roleLabel: true, status: true } },
    },
  })
  if (!project) throw new ApiError('NOT_FOUND', { message: '作品不存在。' })
  const members = await prisma.projectMember.findMany({
    where: { projectId },
    orderBy: { createdAt: 'asc' },
    include: { user: { select: { id: true, name: true, role: true, roleLabel: true, status: true } } },
  })
  const items = members.map((member) => ({
    userId: member.userId,
    name: member.user.name,
    accountRole: member.user.role,
    role: member.role,
    permissions: member.permissions,
    effectivePermissions: effectiveProjectMemberPermissions(member),
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
      accountRole: project.createdBy.role,
      role: 'owner',
      permissions: null,
      effectivePermissions: effectiveProjectMemberPermissions({ role: 'owner' }),
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

export async function addProjectMember(
  session: AuthSession,
  projectId: string,
  input: string | { userId: string },
) {
  const grant = typeof input === 'string' ? { userId: input } : input
  const { actor, project } = await requireProjectMemberManager(session, projectId)
  await requireActiveWorkspaceUser(actor.workspaceOwnerId, grant.userId)
  return prisma.projectMember.upsert({
    where: { projectId_userId: { projectId, userId: grant.userId } },
    update: {},
    create: {
      projectId,
      userId: grant.userId,
      role: grant.userId === project.createdById ? 'owner' : 'member',
      canManageAssignments: grant.userId === project.createdById,
      canReviewAssignments: grant.userId === project.createdById,
    },
    include: { user: { select: { id: true, name: true, role: true, status: true } } },
  })
}

export async function removeProjectMember(session: AuthSession, projectId: string, userId: string) {
  const { project } = await requireProjectMemberManager(session, projectId)
  if (userId === project.createdById) {
    throw new ApiError('CONFLICT', { message: '不能移除作品创建者。' })
  }
  await prisma.projectMember.deleteMany({ where: { projectId, userId } })
}
