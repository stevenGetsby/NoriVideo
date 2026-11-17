import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireSuperAdminAuth } from '@/lib/api-auth'
import { unbanWork } from '@/lib/mp/release/lifecycle'

export const runtime = 'nodejs'

type RouteContext = { params: Promise<{ id: string }> }

export const POST = apiHandler(async (_request: NextRequest, context: RouteContext) => {
  const authResult = await requireSuperAdminAuth()
  if (isErrorResponse(authResult)) return authResult
  const { id } = await context.params
  await unbanWork(id)
  return NextResponse.json({ ok: true })
})
