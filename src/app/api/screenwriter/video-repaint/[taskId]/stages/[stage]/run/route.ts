import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'
import { runStage } from '@/lib/screenwriter/service'
import { ensureFound } from '../../../../../_utils'

export const POST = apiHandler(async (
  _request: NextRequest,
  context: { params: Promise<{ taskId: string; stage: string }> },
) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const userId = authResult.session.user.id
  const { taskId, stage } = await context.params
  const task = ensureFound(await runStage({ userId, taskId, stage }))
  return NextResponse.json({ success: true, task })
})
