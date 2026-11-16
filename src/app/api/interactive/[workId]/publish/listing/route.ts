import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireUserPermission } from '@/lib/api-auth'
import { saveListing } from '@/lib/mp/listing'
import { requirePublishAccess } from '@/lib/mp/publish'

type RouteContext = { params: Promise<{ workId: string }> }

export const PATCH = apiHandler(async (request: NextRequest, context: RouteContext) => {
  const authResult = await requireUserPermission(['canvasWrite'])
  if (isErrorResponse(authResult)) return authResult
  const { workId } = await context.params
  await requirePublishAccess(authResult.session, workId)
  const body = await request.json().catch(() => ({}))
  return NextResponse.json({ listing: await saveListing(workId, body) })
})
