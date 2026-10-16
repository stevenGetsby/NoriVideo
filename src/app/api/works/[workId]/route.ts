import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'
import { deleteWork, updateWork } from '@/lib/works/service'

type Context = { params: Promise<{ workId: string }> }

export const PATCH = apiHandler(async (request: NextRequest, context: Context) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { workId } = await context.params
  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const work = await updateWork(authResult.session, workId, { name: body.name })
  return NextResponse.json({ project: { ...work, kind: 'project' }, work })
})

export const DELETE = apiHandler(async (_request: NextRequest, context: Context) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { workId } = await context.params
  await deleteWork(authResult.session, workId)
  return NextResponse.json({ success: true })
})
