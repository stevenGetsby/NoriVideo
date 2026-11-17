import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireSuperAdminAuth } from '@/lib/api-auth'
import { archiveOpsChannel } from '@/lib/mp/ops'

export const runtime = 'nodejs'

type RouteContext = { params: Promise<{ id: string }> }

export const POST = apiHandler(async (_request: NextRequest, context: RouteContext) => {
  const authResult = await requireSuperAdminAuth()
  if (isErrorResponse(authResult)) return authResult
  const { id } = await context.params
  return NextResponse.json(await archiveOpsChannel(id))
})
