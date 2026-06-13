import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'
import {
  getRunSnapshot,
  listArtifacts,
  listCheckpoints,
  listRunEventsAfterSeq,
} from '@/lib/run-runtime/service'

export const GET = apiHandler(async (
  _request: NextRequest,
  context: { params: Promise<{ runId: string }> },
) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult
  const { runId } = await context.params

  const snapshot = await getRunSnapshot(runId)
  if (!snapshot || snapshot.run.userId !== session.user.id) {
    throw new ApiError('NOT_FOUND')
  }

  const [events, artifacts, checkpoints] = await Promise.all([
    listRunEventsAfterSeq({
      runId,
      userId: session.user.id,
      afterSeq: 0,
      limit: 500,
    }),
    listArtifacts({
      runId,
      limit: 500,
    }),
    listCheckpoints({
      runId,
      limit: 50,
    }),
  ])

  return NextResponse.json({
    ...snapshot,
    events,
    artifacts,
    checkpoints,
  })
})
