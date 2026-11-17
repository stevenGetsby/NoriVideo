import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireSuperAdminAuth } from '@/lib/api-auth'
import { createOpsChannel, listOpsChannels } from '@/lib/mp/ops'

export const runtime = 'nodejs'

export const GET = apiHandler(async () => {
  const authResult = await requireSuperAdminAuth()
  if (isErrorResponse(authResult)) return authResult
  return NextResponse.json(await listOpsChannels())
})

export const POST = apiHandler(async (request: NextRequest) => {
  const authResult = await requireSuperAdminAuth()
  if (isErrorResponse(authResult)) return authResult
  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  return NextResponse.json(await createOpsChannel(body, authResult.session.user.id))
})
