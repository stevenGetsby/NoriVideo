import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'
import { getRunById, listRunEventsAfterSeq } from '@/lib/run-runtime/service'
import { isPublicRunApiVisible } from '@/lib/super-agent/internal-run-visibility'

export const GET = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ runId: string }> },
) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult
  const { runId } = await context.params
  const afterSeqRaw = Number.parseInt(request.nextUrl.searchParams.get('afterSeq') || '0', 10)
  const limitRaw = Number.parseInt(request.nextUrl.searchParams.get('limit') || '200', 10)
  const afterSeq = Number.isFinite(afterSeqRaw) ? Math.max(0, afterSeqRaw) : 0
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 2000) : 200

  const run = await getRunById(runId)
  if (!run || run.userId !== session.user.id || !isPublicRunApiVisible(run)) {
    throw new ApiError('NOT_FOUND')
  }

  const events = await listRunEventsAfterSeq({
    runId,
    userId: session.user.id,
    afterSeq,
    limit,
  })
  return NextResponse.json({
    runId,
    afterSeq,
    events,
  })
})
