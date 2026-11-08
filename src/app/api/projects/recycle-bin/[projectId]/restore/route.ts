import { NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'
import { getWorkspaceActor } from '@/lib/collaboration/access'
import { prisma } from '@/lib/prisma'
import { projectRestoreDeadline } from '@/lib/projects/recycle-bin'

export const POST = apiHandler(async (
  _request: Request,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult
  const actor = getWorkspaceActor(session)
  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      userId: actor.workspaceOwnerId,
      deletedAt: { not: null },
    },
    select: {
      id: true,
      name: true,
      createdById: true,
      deletedAt: true,
      workId: true,
      work: {
        select: {
          createdById: true,
          members: { where: { userId: actor.actorId }, select: { role: true, canManage: true, permissions: true }, take: 1 },
        },
      },
      members: { where: { userId: actor.actorId }, select: { role: true, permissions: true, canManageAssignments: true, canReviewAssignments: true }, take: 1 },
    },
  })
  if (!project) throw new ApiError('NOT_FOUND', { message: '回收站作品不存在。' })
  if (!actor.isManagement && project.createdById !== actor.actorId) {
    throw new ApiError('FORBIDDEN', { message: '只有作品创建者可以恢复该作品。' })
  }
  if (projectRestoreDeadline(project.deletedAt!).getTime() <= Date.now()) {
    throw new ApiError('CONFLICT', { message: '该作品已超过 15 天恢复期限。' })
  }

  const restored = await prisma.$transaction(async (tx) => {
    await tx.work.updateMany({
      where: { id: project.workId, workspaceOwnerId: actor.workspaceOwnerId, deletedAt: { not: null } },
      data: { deletedAt: null, deletedById: null },
    })
    await tx.project.updateMany({
      where: { workId: project.workId, userId: actor.workspaceOwnerId, deletedAt: { not: null }, deletedWithWork: true },
      data: { deletedWithWork: false },
    })
    return tx.project.update({
      where: { id: project.id },
      data: { deletedAt: null, deletedById: null, deletedWithWork: false },
      select: { id: true, name: true, workId: true },
    })
  })
  return NextResponse.json({ success: true, project: restored })
})
