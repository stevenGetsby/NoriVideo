import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireSuperAdminAuth } from '@/lib/api-auth'
import { adminStats } from '@/lib/mp/stats'

export const runtime = 'nodejs'

export const GET = apiHandler(async (request: NextRequest) => {
  const authResult = await requireSuperAdminAuth()
  if (isErrorResponse(authResult)) return authResult
  return NextResponse.json(await adminStats(request.nextUrl.searchParams.get('range')))
})
