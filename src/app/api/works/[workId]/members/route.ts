import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'
import { addWorkMember, listWorkMembers, readWorkMemberGrant, removeWorkMember } from '@/lib/works/service'

type Context = { params: Promise<{ workId: string }> }

export const GET = apiHandler(async (_request: NextRequest, context: Context) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { workId } = await context.params
  return NextResponse.json({ members: await listWorkMembers(authResult.session, workId) })
})

export const POST = apiHandler(async (request: NextRequest, context: Context) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { workId } = await context.params
  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const member = await addWorkMember(authResult.session, workId, readWorkMemberGrant(body))
  return NextResponse.json({ member }, { status: 201 })
})

export const DELETE = apiHandler(async (request: NextRequest, context: Context) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { workId } = await context.params
  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  await removeWorkMember(authResult.session, workId, readWorkMemberGrant(body).userId)
  return NextResponse.json({ success: true })
})
