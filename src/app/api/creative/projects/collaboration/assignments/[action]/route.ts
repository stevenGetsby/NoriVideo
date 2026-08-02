import { NextRequest } from 'next/server'
import { ApiError, apiHandler } from '@/lib/api-errors'
import {
  handleAssignmentGet,
  handleAssignmentPost,
  type AssignmentGetEndpoint,
  type AssignmentPostEndpoint,
} from '@/lib/collaboration/assignment-http'

type Context = { params: Promise<{ action: string }> }

const GET_ACTIONS = new Set<AssignmentGetEndpoint>([
  'my',
  'pending-review',
  'counts',
  'pending-review-count',
  'list',
  'candidates',
])
const POST_ACTIONS = new Set<AssignmentPostEndpoint>([
  'assign',
  'submit',
  'approve',
  'reject',
  'mark-complete',
  'reopen',
  'batch-assign',
  'batch-approve',
  'batch-reject',
])

export const GET = apiHandler(async (request: NextRequest, context: Context) => {
  const { action } = await context.params
  if (!GET_ACTIONS.has(action as AssignmentGetEndpoint)) {
    throw new ApiError('NOT_FOUND', { message: '协作任务接口不存在。' })
  }
  return handleAssignmentGet(request, action as AssignmentGetEndpoint, true)
})

export const POST = apiHandler(async (request: NextRequest, context: Context) => {
  const { action } = await context.params
  if (!POST_ACTIONS.has(action as AssignmentPostEndpoint)) {
    throw new ApiError('NOT_FOUND', { message: '协作任务接口不存在。' })
  }
  return handleAssignmentPost(request, action as AssignmentPostEndpoint, true)
})
