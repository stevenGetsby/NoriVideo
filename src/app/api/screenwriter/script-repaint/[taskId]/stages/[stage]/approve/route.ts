import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'
import { approveStage } from '@/lib/screenwriter/service'
import { ensureFound, readOptionalString } from '../../../../../_utils'

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ taskId: string; stage: string }> },
) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const userId = authResult.session.user.id
  const { taskId, stage } = await context.params
  const body = await request.json().catch(() => ({}))
  const payload = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {}
  const task = ensureFound(await approveStage({
    userId,
    taskId,
    stage,
    feedback: readOptionalString(payload.feedback) || null,
  }))
  return NextResponse.json({ success: true, task })
})
