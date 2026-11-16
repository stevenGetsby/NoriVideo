import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireUserPermission } from '@/lib/api-auth'
import { requirePublishAccess } from '@/lib/mp/publish'
import { onlineWork } from '@/lib/mp/release/lifecycle'
import { prisma } from '@/lib/prisma'

type RouteContext = { params: Promise<{ workId: string }> }

export const POST = apiHandler(async (_request: NextRequest, context: RouteContext) => {
  const authResult = await requireUserPermission(['canvasWrite'])
  if (isErrorResponse(authResult)) return authResult
  const { workId } = await context.params
  await requirePublishAccess(authResult.session, workId)
  const mpWork = await prisma.mpWork.findUnique({ where: { workId }, select: { id: true } })
  if (!mpWork) throw new ApiError('NOT_FOUND', { message: '上架条目不存在。' })
  await onlineWork(mpWork.id)
  return NextResponse.json({ success: true })
})
