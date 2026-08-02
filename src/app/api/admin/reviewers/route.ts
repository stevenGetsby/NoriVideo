import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { forbidden, isErrorResponse, requireAdminAuth } from '@/lib/api-auth'
import { normalizeAccountRole } from '@/lib/account/permissions'
import { syncProjectAssignmentsForProject } from '@/lib/collaboration/assignments'
import { logInfo } from '@/lib/logging/core'
import { prisma } from '@/lib/prisma'

const DELETED_ACCOUNT_STATUS = 'deleted'

function cleanId(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

async function requirePlatformAdmin() {
  const authResult = await requireAdminAuth()
  if (isErrorResponse(authResult)) return authResult
  if (normalizeAccountRole(authResult.session.user.role) !== 'super_admin') {
    return forbidden('只有平台 Admin 可以分配项目审核人员。')
  }
  return authResult
}

export const GET = apiHandler(async () => {
  const authResult = await requirePlatformAdmin()
  if (isErrorResponse(authResult)) return authResult

  const actorId = authResult.session.user.actorId || authResult.session.user.id
  const managers = await prisma.user.findMany({
    where: {
      role: 'admin',
      parentAccountId: actorId,
      status: { not: DELETED_ACCOUNT_STATUS },
    },
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true, status: true },
  })
  const managerIds = managers.map((manager) => manager.id)
  const [projects, reviewers] = await Promise.all([
    prisma.project.findMany({
      where: { userId: { in: managerIds } },
      orderBy: [{ updatedAt: 'desc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        userId: true,
        collaborationMode: true,
        work: { select: { name: true } },
      },
    }),
    prisma.user.findMany({
      where: {
        role: 'reviewer',
        workspaceOwnerId: { in: managerIds },
        status: { not: DELETED_ACCOUNT_STATUS },
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        name: true,
        roleLabel: true,
        status: true,
        workspaceOwnerId: true,
      },
    }),
  ])
  const projectIds = projects.map((project) => project.id)
  const reviewerIds = reviewers.map((reviewer) => reviewer.id)
  const memberships = projectIds.length && reviewerIds.length
    ? await prisma.projectMember.findMany({
      where: {
        projectId: { in: projectIds },
        userId: { in: reviewerIds },
        canReviewAssignments: true,
      },
      select: { projectId: true, userId: true },
    })
    : []
  const reviewersByProject = new Map<string, string[]>()
  for (const membership of memberships) {
    const current = reviewersByProject.get(membership.projectId) || []
    current.push(membership.userId)
    reviewersByProject.set(membership.projectId, current)
  }

  return NextResponse.json({
    success: true,
    workspaces: managers.map((manager) => ({
      manager: {
        id: manager.id,
        username: manager.name,
        status: manager.status,
      },
      reviewers: reviewers
        .filter((reviewer) => reviewer.workspaceOwnerId === manager.id)
        .map((reviewer) => ({
          id: reviewer.id,
          username: reviewer.name,
          roleLabel: reviewer.roleLabel || '审核员',
          status: reviewer.status,
        })),
      projects: projects
        .filter((project) => project.userId === manager.id)
        .map((project) => ({
          id: project.id,
          name: project.name,
          workName: project.work.name,
          collaborationMode: project.collaborationMode,
          reviewerIds: reviewersByProject.get(project.id) || [],
        })),
    })),
  })
})

export const PUT = apiHandler(async (request: NextRequest) => {
  const authResult = await requirePlatformAdmin()
  if (isErrorResponse(authResult)) return authResult

  const actorId = authResult.session.user.actorId || authResult.session.user.id
  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const projectId = cleanId(body.projectId)
  const reviewerIds = Array.isArray(body.reviewerIds)
    ? Array.from(new Set(body.reviewerIds.map(cleanId).filter(Boolean)))
    : null
  if (!projectId || reviewerIds === null) {
    throw new ApiError('INVALID_PARAMS', { message: '缺少项目或审核员列表。' })
  }

  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      user: { role: 'admin', parentAccountId: actorId, status: { not: DELETED_ACCOUNT_STATUS } },
    },
    select: { id: true, name: true, userId: true, collaborationMode: true },
  })
  if (!project) throw new ApiError('NOT_FOUND', { message: '项目不存在或不属于当前平台 Admin。' })

  const reviewers = reviewerIds.length
    ? await prisma.user.findMany({
      where: {
        id: { in: reviewerIds },
        role: 'reviewer',
        status: 'active',
        workspaceOwnerId: project.userId,
      },
      select: { id: true },
    })
    : []
  if (reviewers.length !== reviewerIds.length) {
    throw new ApiError('INVALID_PARAMS', { message: '只能选择该管理工作区内已启用的审核员。' })
  }

  const workspaceReviewerIds = (await prisma.user.findMany({
    where: {
      role: 'reviewer',
      workspaceOwnerId: project.userId,
      status: { not: DELETED_ACCOUNT_STATUS },
    },
    select: { id: true },
  })).map((reviewer) => reviewer.id)
  const existing = workspaceReviewerIds.length
    ? await prisma.projectMember.findMany({
      where: { projectId, userId: { in: workspaceReviewerIds } },
      select: { id: true, userId: true, canManageAssignments: true, canReviewAssignments: true },
    })
    : []
  const selected = new Set(reviewerIds)

  await prisma.$transaction([
    ...existing
      .filter((membership) => membership.canReviewAssignments && !selected.has(membership.userId))
      .map((membership) => membership.canManageAssignments
        ? prisma.projectMember.update({
          where: { id: membership.id },
          data: { canReviewAssignments: false },
        })
        : prisma.projectMember.delete({ where: { id: membership.id } })),
    ...reviewerIds.map((reviewerId) => prisma.projectMember.upsert({
      where: { projectId_userId: { projectId, userId: reviewerId } },
      create: {
        projectId,
        userId: reviewerId,
        canManageAssignments: false,
        canReviewAssignments: true,
      },
      update: { canReviewAssignments: true },
    })),
    ...(reviewerIds.length && project.collaborationMode !== 'team'
      ? [prisma.project.update({ where: { id: projectId }, data: { collaborationMode: 'team' } })]
      : []),
  ])

  if (reviewerIds.length && project.collaborationMode !== 'team') {
    await syncProjectAssignmentsForProject({ projectId, workspaceOwnerId: project.userId })
  }
  logInfo('[ReviewerAdmin] 项目审核员已更新', {
    operatorUserId: actorId,
    projectId,
    projectName: project.name,
    reviewerIds,
  })
  return NextResponse.json({ success: true, projectId, reviewerIds })
})
