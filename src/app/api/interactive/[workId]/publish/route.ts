import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireUserPermission } from '@/lib/api-auth'
import { getPublishOverview, requirePublishAccess } from '@/lib/mp/publish'

type RouteContext = { params: Promise<{ workId: string }> }

export const GET = apiHandler(async (_request: NextRequest, context: RouteContext) => {
  const authResult = await requireUserPermission(['canvasWrite'])
  if (isErrorResponse(authResult)) return authResult
  const { workId } = await context.params
  await requirePublishAccess(authResult.session, workId)
  return NextResponse.json(await getPublishOverview(workId))
})
