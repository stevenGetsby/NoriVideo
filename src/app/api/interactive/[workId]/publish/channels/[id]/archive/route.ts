import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireUserPermission } from '@/lib/api-auth'
import { archiveChannel } from '@/lib/mp/channels'
import { requirePublishAccess } from '@/lib/mp/publish'

type RouteContext = { params: Promise<{ workId: string; id: string }> }

export const POST = apiHandler(async (_request: NextRequest, context: RouteContext) => {
  const authResult = await requireUserPermission(['canvasWrite'])
  if (isErrorResponse(authResult)) return authResult
  const { workId, id } = await context.params
  await requirePublishAccess(authResult.session, workId)
  return NextResponse.json(await archiveChannel(workId, id))
})
