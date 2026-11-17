import { NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireSuperAdminAuth } from '@/lib/api-auth'
import { listOpsReports } from '@/lib/mp/ops'

export const runtime = 'nodejs'

export const GET = apiHandler(async () => {
  const authResult = await requireSuperAdminAuth()
  if (isErrorResponse(authResult)) return authResult
  return NextResponse.json(await listOpsReports())
})
