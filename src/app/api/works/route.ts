import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'
import { createWork, listWorks } from '@/lib/works/service'

export const GET = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const params = request.nextUrl.searchParams
  const result = await listWorks(authResult.session, {
    page: params.get('page'),
    pageSize: params.get('pageSize'),
    search: params.get('search'),
  })
  return NextResponse.json(result)
})

export const POST = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const work = await createWork(authResult.session, {
    name: body.name,
    memberUserIds: body.memberUserIds,
  })
  return NextResponse.json({ work }, { status: 201 })
})
