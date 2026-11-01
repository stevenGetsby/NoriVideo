import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'
import { addProjectMember, listProjectMembers, readProjectMemberGrant, removeProjectMember } from '@/lib/works/service'

type Context = { params: Promise<{ projectId: string }> }

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
  const member = await addProjectMember(authResult.session, projectId, readProjectMemberGrant(body))
  return NextResponse.json({ member }, { status: 201 })
})

export const DELETE = apiHandler(async (request: NextRequest, context: Context) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { projectId } = await context.params
  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  await removeProjectMember(authResult.session, projectId, readProjectMemberGrant(body).userId)
  return NextResponse.json({ success: true })
})
