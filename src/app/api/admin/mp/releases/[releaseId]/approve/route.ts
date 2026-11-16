import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireSuperAdminAuth } from '@/lib/api-auth'
import { approveRelease } from '@/lib/mp/release/lifecycle'

export const runtime = 'nodejs'

type RouteContext = { params: Promise<{ releaseId: string }> }

export const POST = apiHandler(async (_request: NextRequest, context: RouteContext) => {
  const authResult = await requireSuperAdminAuth()
  if (isErrorResponse(authResult)) return authResult
  const { releaseId } = await context.params
  const outcome = await approveRelease(releaseId, authResult.session.user.id)
  return NextResponse.json({ success: true, scheduled: outcome.scheduled })
})
