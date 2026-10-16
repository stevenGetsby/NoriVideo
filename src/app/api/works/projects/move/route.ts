import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'
import { moveProjects } from '@/lib/works/service'

export const POST = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const value: unknown = await request.json().catch(() => null)
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiError('INVALID_PARAMS', { message: '移动请求必须是有效的 JSON 对象。' })
  }
  const body = value as Record<string, unknown>
  const result = await moveProjects(authResult.session, {
    workIds: body.workIds,
    targetProjectId: body.targetProjectId,
    projectIds: body.projectIds,
    targetWorkId: body.targetWorkId,
  })
  return NextResponse.json(result)
})
