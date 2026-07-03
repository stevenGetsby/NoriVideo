import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'
import { retryStage } from '@/lib/screenwriter/service'
import { ensureFound } from '../../../../../_utils'

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ taskId: string; stage: string }> },
) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const userId = authResult.session.user.id
  const { taskId, stage } = await context.params
  const body = await request.json().catch(() => ({}))
  const payload = body && typeof body === 'object' && !Array.isArray(body)
    ? body as Record<string, unknown>
    : {}
  const episodeNumber = typeof payload.episodeNumber === 'number' ? payload.episodeNumber : null
  const task = ensureFound(await retryStage({ userId, taskId, stage, episodeNumber }))
  return NextResponse.json({ success: true, task })
})
