import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireUserPermission } from '@/lib/api-auth'
import { createChannel, listChannels, toChannelRow } from '@/lib/mp/channels'
import { MpApiError } from '@/lib/mp/errors'
import { requirePublishAccess } from '@/lib/mp/publish'
import { prisma } from '@/lib/prisma'

type RouteContext = { params: Promise<{ workId: string }> }

export const GET = apiHandler(async (_request: NextRequest, context: RouteContext) => {
  const authResult = await requireUserPermission(['canvasWrite'])
  if (isErrorResponse(authResult)) return authResult
  const { workId } = await context.params
  await requirePublishAccess(authResult.session, workId)
  return NextResponse.json(await listChannels(workId))
})

export const POST = apiHandler(async (request: NextRequest, context: RouteContext) => {
  const authResult = await requireUserPermission(['canvasWrite'])
  if (isErrorResponse(authResult)) return authResult
  const { workId } = await context.params
  await requirePublishAccess(authResult.session, workId)
  const body = await request.json().catch(() => ({})) as { name?: unknown }
  const work = await prisma.mpWork.findUnique({ where: { workId }, select: { id: true, slug: true } })
  if (!work) throw new MpApiError('MP_INVALID_STATE', { message: '作品上线后可以生成推广渠道' })
  const channel = await createChannel({
    kind: 'creator',
    name: typeof body?.name === 'string' ? body.name : '',
    mpWorkId: work.id,
    userId: authResult.session.user.id,
  })
  return NextResponse.json({ channel: await toChannelRow(channel, work.slug) })
})
