import { NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'
import { getAssignmentDetail } from '@/lib/collaboration/assignments'

export const GET = apiHandler(async (_request, context) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { assignmentId } = await context.params
  return NextResponse.json(await getAssignmentDetail(authResult.session, assignmentId))
})
