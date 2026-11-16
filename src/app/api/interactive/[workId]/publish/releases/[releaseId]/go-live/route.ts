import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireUserPermission } from '@/lib/api-auth'
import { requirePublishAccess } from '@/lib/mp/publish'
import { goLive } from '@/lib/mp/release/lifecycle'
import { prisma } from '@/lib/prisma'

type RouteContext = { params: Promise<{ workId: string; releaseId: string }> }

export const POST = apiHandler(async (_request: NextRequest, context: RouteContext) => {
  const authResult = await requireUserPermission(['canvasWrite'])
  if (isErrorResponse(authResult)) return authResult
  const { workId, releaseId } = await context.params
  await requirePublishAccess(authResult.session, workId)
  const release = await prisma.storyRelease.findUnique({ where: { id: releaseId }, select: { workId: true } })
  if (!release || release.workId !== workId) throw new ApiError('NOT_FOUND', { message: '版本不存在。' })
  await goLive(releaseId)
  return NextResponse.json({ success: true })
})
