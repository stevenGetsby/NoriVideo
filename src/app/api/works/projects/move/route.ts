import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'
import { moveProjects } from '@/lib/works/service'

export const POST = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const result = await moveProjects(authResult.session, {
    projectIds: body.projectIds,
    targetWorkId: body.targetWorkId,
  })
  return NextResponse.json(result)
})
