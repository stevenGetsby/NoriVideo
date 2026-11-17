import { NextRequest, NextResponse } from 'next/server'
import { ApiError, apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireSuperAdminAuth } from '@/lib/api-auth'
import { banWork } from '@/lib/mp/release/lifecycle'

export const runtime = 'nodejs'

type RouteContext = { params: Promise<{ id: string }> }

export const POST = apiHandler(async (request: NextRequest, context: RouteContext) => {
  const authResult = await requireSuperAdminAuth()
  if (isErrorResponse(authResult)) return authResult
  const { id } = await context.params
  const body = await request.json().catch(() => ({})) as { reason?: unknown }
  const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
  const length = [...reason].length
  if (length < 2 || length > 200) throw new ApiError('INVALID_PARAMS', { message: '封禁原因需要 2–200 字' })
  await banWork(id, reason, authResult.session.user.id)
  return NextResponse.json({ ok: true })
})
