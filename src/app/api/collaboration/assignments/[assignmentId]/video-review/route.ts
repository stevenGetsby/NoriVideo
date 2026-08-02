import { NextResponse } from 'next/server'
import { ApiError, apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'
import { getVideoReviewContext } from '@/lib/collaboration/video-review'

export const GET = apiHandler(async (_request, context) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { assignmentId } = await context.params
  if (typeof assignmentId !== 'string' || !assignmentId.trim()) throw new ApiError('INVALID_PARAMS')
  return NextResponse.json(await getVideoReviewContext(authResult.session, assignmentId))
})
