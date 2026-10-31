import { NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'
import { getWorkspaceActor } from '@/lib/collaboration/access'
import { prisma } from '@/lib/prisma'
import { projectRestoreDeadline } from '@/lib/projects/recycle-bin'

export const GET = apiHandler(async () => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult
  const actor = getWorkspaceActor(session)
  if (!actor.isManagement) {
    throw new ApiError('FORBIDDEN', { message: '只有管理账号可以查看回收站。' })
  }

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
        deletedAt: true,
        deletedById: true,
        deletedWithWork: true,
        work: { select: { id: true, name: true, deletedAt: true } },
      },
    }),
    prisma.work.findMany({
      where: { workspaceOwnerId: actor.workspaceOwnerId, deletedAt: { not: null } },
      orderBy: { deletedAt: 'desc' },
      take: 100,
      select: { id: true, name: true, deletedAt: true },
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
    works: works.map((work) => {
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
    projects: projects.map((project) => {
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
