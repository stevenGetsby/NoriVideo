import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireUserPermission } from '@/lib/api-auth'
import { requirePublishAccess } from '@/lib/mp/publish'
import { creatorStats } from '@/lib/mp/stats'

export const runtime = 'nodejs'

type RouteContext = { params: Promise<{ workId: string }> }

export const GET = apiHandler(async (request: NextRequest, context: RouteContext) => {
  const authResult = await requireUserPermission(['canvasWrite'])
  if (isErrorResponse(authResult)) return authResult
  const { workId } = await context.params
  await requirePublishAccess(authResult.session, workId)
  return NextResponse.json(await creatorStats(workId, request.nextUrl.searchParams.get('range')))
})
