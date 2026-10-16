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
  if (!actor.isManagement) {
    throw new ApiError('FORBIDDEN', { message: '只有管理账号可以恢复回收站作品。' })
  }

  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      userId: actor.workspaceOwnerId,
      deletedAt: { not: null },
    },
    select: { id: true, name: true, deletedAt: true },
  })
  if (!project) throw new ApiError('NOT_FOUND', { message: '回收站作品不存在。' })
  if (projectRestoreDeadline(project.deletedAt!).getTime() <= Date.now()) {
    throw new ApiError('CONFLICT', { message: '该作品已超过 15 天恢复期限。' })
  }

  const restored = await prisma.project.update({
    where: { id: project.id },
    data: { deletedAt: null, deletedById: null },
    select: { id: true, name: true, workId: true },
  })
  return NextResponse.json({ success: true, project: restored })
})
