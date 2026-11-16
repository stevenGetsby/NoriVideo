import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireSuperAdminAuth } from '@/lib/api-auth'
import { listReleasesForReview } from '@/lib/mp/review'

export const runtime = 'nodejs'

export const GET = apiHandler(async (request: NextRequest) => {
  const authResult = await requireSuperAdminAuth()
  if (isErrorResponse(authResult)) return authResult
  const tab = request.nextUrl.searchParams.get('status') === 'done' ? 'done' : 'pending'
  return NextResponse.json(await listReleasesForReview(tab))
})
