import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireSuperAdminAuth } from '@/lib/api-auth'
import { listOpsTopics, saveOpsTopic } from '@/lib/mp/ops'

export const runtime = 'nodejs'

export const GET = apiHandler(async () => {
  const authResult = await requireSuperAdminAuth()
  if (isErrorResponse(authResult)) return authResult
  return NextResponse.json(await listOpsTopics())
})

export const POST = apiHandler(async (request: NextRequest) => {
  const authResult = await requireSuperAdminAuth()
  if (isErrorResponse(authResult)) return authResult
  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  return NextResponse.json(await saveOpsTopic(body))
})
