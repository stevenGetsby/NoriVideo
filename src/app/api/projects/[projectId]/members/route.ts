import { NextRequest, NextResponse } from 'next/server'
import { ApiError, apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'
import { addProjectMember, listProjectMembers, removeProjectMember } from '@/lib/works/service'

type Context = { params: Promise<{ projectId: string }> }

function readUserId(body: Record<string, unknown>) {
  const userId = typeof body.userId === 'string' ? body.userId.trim() : ''
  if (!userId) throw new ApiError('INVALID_PARAMS', { message: '请选择成员账号。' })
  return userId
}

export const GET = apiHandler(async (_request: NextRequest, context: Context) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { projectId } = await context.params
  return NextResponse.json({ members: await listProjectMembers(authResult.session, projectId) })
})

export const POST = apiHandler(async (request: NextRequest, context: Context) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { projectId } = await context.params
  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const member = await addProjectMember(authResult.session, projectId, readUserId(body))
  return NextResponse.json({ member }, { status: 201 })
})

export const DELETE = apiHandler(async (request: NextRequest, context: Context) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { projectId } = await context.params
  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  await removeProjectMember(authResult.session, projectId, readUserId(body))
  return NextResponse.json({ success: true })
})
