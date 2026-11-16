import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireSuperAdminAuth } from '@/lib/api-auth'
import { getReleaseForReview } from '@/lib/mp/review'

export const runtime = 'nodejs'

type RouteContext = { params: Promise<{ releaseId: string }> }

export const GET = apiHandler(async (_request: NextRequest, context: RouteContext) => {
  const authResult = await requireSuperAdminAuth()
  if (isErrorResponse(authResult)) return authResult
  const { releaseId } = await context.params
  return NextResponse.json(await getReleaseForReview(releaseId))
})
