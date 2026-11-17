import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireSuperAdminAuth } from '@/lib/api-auth'
import { deleteOpsSlot, moveOpsSlot, saveOpsSlot } from '@/lib/mp/ops'

export const runtime = 'nodejs'

type RouteContext = { params: Promise<{ id: string }> }

export const PATCH = apiHandler(async (request: NextRequest, context: RouteContext) => {
  const authResult = await requireSuperAdminAuth()
  if (isErrorResponse(authResult)) return authResult
  const { id } = await context.params
  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  if (body.move === 'up' || body.move === 'down') return NextResponse.json(await moveOpsSlot(id, body.move))
  return NextResponse.json(await saveOpsSlot(body, id))
})

export const DELETE = apiHandler(async (_request: NextRequest, context: RouteContext) => {
  const authResult = await requireSuperAdminAuth()
  if (isErrorResponse(authResult)) return authResult
  const { id } = await context.params
  return NextResponse.json(await deleteOpsSlot(id))
})
