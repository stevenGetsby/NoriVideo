import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireSuperAdminAuth } from '@/lib/api-auth'
import { listOpsWorks } from '@/lib/mp/ops'

export const runtime = 'nodejs'

export const GET = apiHandler(async (request: NextRequest) => {
  const authResult = await requireSuperAdminAuth()
  if (isErrorResponse(authResult)) return authResult
  return NextResponse.json(await listOpsWorks(request.nextUrl.searchParams.get('status'), request.nextUrl.searchParams.get('q')))
})
