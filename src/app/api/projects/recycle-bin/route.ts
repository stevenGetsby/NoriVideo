import { NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'
import { getWorkspaceActor } from '@/lib/collaboration/access'
import { canAccessWork } from '@/lib/permissions/resolve'
import { prisma } from '@/lib/prisma'
import { projectRestoreDeadline } from '@/lib/projects/recycle-bin'

export const GET = apiHandler(async () => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult
  const actor = getWorkspaceActor(session)
  const [projects, works] = await Promise.all([
    prisma.project.findMany({
      where: {
        userId: actor.workspaceOwnerId,
        deletedAt: { not: null },
      },
      orderBy: { deletedAt: 'desc' },
      take: 100,
      select: {
        id: true,
        name: true,
        createdById: true,
        deletedAt: true,
        deletedById: true,
        deletedWithWork: true,
        work: {
          select: {
            id: true,
            name: true,
            createdById: true,
            deletedAt: true,
            members: { where: { userId: actor.actorId }, select: { role: true, canManage: true, permissions: true }, take: 1 },
          },
        },
        members: { where: { userId: actor.actorId }, select: { role: true, permissions: true, canManageAssignments: true, canReviewAssignments: true }, take: 1 },
      },
    }),
    prisma.work.findMany({
      where: { workspaceOwnerId: actor.workspaceOwnerId, deletedAt: { not: null } },
      orderBy: { deletedAt: 'desc' },
      take: 100,
      select: {
        id: true,
        name: true,
        createdById: true,
        deletedAt: true,
        members: { where: { userId: actor.actorId }, select: { role: true, canManage: true, permissions: true }, take: 1 },
      },
    }),
  ])
  const deletedByIds = Array.from(new Set(projects.map((project) => project.deletedById).filter(Boolean))) as string[]
  const deleters = deletedByIds.length > 0
    ? await prisma.user.findMany({
      where: { id: { in: deletedByIds } },
      select: { id: true, name: true },
    })
    : []
  const deletedByNames = new Map(deleters.map((user) => [user.id, user.name]))

  return NextResponse.json({
    success: true,
    works: works.filter((work) => canAccessWork(actor, 'workDelete', work, work.members[0])).map((work) => {
      const deadline = projectRestoreDeadline(work.deletedAt!)
      return {
        id: work.id,
        name: work.name,
        deletedAt: work.deletedAt?.toISOString() || null,
        restoreDeadline: deadline.toISOString(),
        remainingDays: Math.max(0, Math.ceil((deadline.getTime() - Date.now()) / (24 * 60 * 60 * 1000))),
        expired: deadline.getTime() <= Date.now(),
      }
    }),
    projects: projects.filter((project) => actor.isManagement || project.createdById === actor.actorId).map((project) => {
      const deadline = projectRestoreDeadline(project.deletedAt!)
      return {
        id: project.id,
        name: project.name,
        workId: project.work.id,
        workName: project.work.name,
        workDeletedAt: project.work.deletedAt?.toISOString() || null,
        deletedWithWork: project.deletedWithWork,
        deletedAt: project.deletedAt?.toISOString() || null,
        deletedByName: project.deletedById ? deletedByNames.get(project.deletedById) || null : null,
        restoreDeadline: deadline.toISOString(),
        remainingDays: Math.max(0, Math.ceil((deadline.getTime() - Date.now()) / (24 * 60 * 60 * 1000))),
        expired: deadline.getTime() <= Date.now(),
      }
    }),
  })
})
