import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireSuperAdminAuth } from '@/lib/api-auth'
import { deleteOpsTopic, saveOpsTopic } from '@/lib/mp/ops'

export const runtime = 'nodejs'

type RouteContext = { params: Promise<{ id: string }> }

export const PATCH = apiHandler(async (request: NextRequest, context: RouteContext) => {
  const authResult = await requireSuperAdminAuth()
  if (isErrorResponse(authResult)) return authResult
  const { id } = await context.params
  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  return NextResponse.json(await saveOpsTopic(body, id))
})

export const DELETE = apiHandler(async (_request: NextRequest, context: RouteContext) => {
  const authResult = await requireSuperAdminAuth()
  if (isErrorResponse(authResult)) return authResult
  const { id } = await context.params
  return NextResponse.json(await deleteOpsTopic(id))
})
