import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireSuperAdminAuth } from '@/lib/api-auth'
import { rejectRelease } from '@/lib/mp/release/lifecycle'

export const runtime = 'nodejs'

type RouteContext = { params: Promise<{ releaseId: string }> }

export const POST = apiHandler(async (request: NextRequest, context: RouteContext) => {
  const authResult = await requireSuperAdminAuth()
  if (isErrorResponse(authResult)) return authResult
  const { releaseId } = await context.params
  const body = await request.json().catch(() => ({})) as { note?: unknown }
  const note = typeof body?.note === 'string' ? body.note : ''
  await rejectRelease(releaseId, authResult.session.user.id, note)
  return NextResponse.json({ success: true })
})
