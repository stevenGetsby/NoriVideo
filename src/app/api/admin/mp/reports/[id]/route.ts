import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireSuperAdminAuth } from '@/lib/api-auth'
import { updateOpsReport } from '@/lib/mp/ops'

export const runtime = 'nodejs'

type RouteContext = { params: Promise<{ id: string }> }

export const PATCH = apiHandler(async (request: NextRequest, context: RouteContext) => {
  const authResult = await requireSuperAdminAuth()
  if (isErrorResponse(authResult)) return authResult
  const { id } = await context.params
  const body = await request.json().catch(() => ({})) as { status?: unknown }
  return NextResponse.json(await updateOpsReport(id, body.status, authResult.session.user.id))
})
