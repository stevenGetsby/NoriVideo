import { NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'
import { getWorkspaceActor } from '@/lib/collaboration/access'
import { canAccessWork } from '@/lib/permissions/resolve'
import { prisma } from '@/lib/prisma'
import { projectRestoreDeadline } from '@/lib/projects/recycle-bin'

export const POST = apiHandler(async (
  _request: Request,
  context: { params: Promise<{ workId: string }> },
) => {
  const { workId } = await context.params
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const actor = getWorkspaceActor(authResult.session)
  const work = await prisma.work.findFirst({
    where: { id: workId, workspaceOwnerId: actor.workspaceOwnerId, deletedAt: { not: null } },
    select: {
      id: true,
      name: true,
      createdById: true,
      deletedAt: true,
      members: { where: { userId: actor.actorId }, select: { role: true, canManage: true, permissions: true }, take: 1 },
    },
  })
  if (!work) throw new ApiError('NOT_FOUND', { message: '回收站项目不存在。' })
  if (!canAccessWork(actor, 'workDelete', work, work.members[0])) {
    throw new ApiError('FORBIDDEN', { message: '当前账号没有恢复该项目的权限。' })
  }
  if (projectRestoreDeadline(work.deletedAt!).getTime() <= Date.now()) {
    throw new ApiError('CONFLICT', { message: '该项目已超过 15 天恢复期限。' })
  }
  const restored = await prisma.$transaction(async (tx) => {
    await tx.work.update({ where: { id: work.id }, data: { deletedAt: null, deletedById: null } })
    return tx.project.updateMany({
      where: { workId: work.id, userId: actor.workspaceOwnerId, deletedWithWork: true },
      data: { deletedAt: null, deletedById: null, deletedWithWork: false },
    })
  })
  return NextResponse.json({ success: true, work: { id: work.id, name: work.name }, restoredProjects: restored.count })
})
