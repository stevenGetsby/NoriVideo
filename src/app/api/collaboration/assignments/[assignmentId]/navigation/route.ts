import { NextResponse } from 'next/server'
import { ApiError, apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'
import {
  parseAssignmentNavigationIntent,
  validateAssignmentNavigation,
} from '@/lib/collaboration/assignment-navigation'

export const GET = apiHandler(async (request, context) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const params = await context.params
  const assignmentId = typeof params.assignmentId === 'string' ? params.assignmentId.trim() : ''
  if (!assignmentId) throw new ApiError('INVALID_PARAMS', { message: '缺少任务 ID。' })
  const intent = parseAssignmentNavigationIntent(request.nextUrl.searchParams.get('intent') || 'view')
  return NextResponse.json(await validateAssignmentNavigation(authResult.session, assignmentId, intent))
})
