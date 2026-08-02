import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'
import { listMemberCandidates } from '@/lib/works/service'

type Context = { params: Promise<{ workId: string }> }

export const GET = apiHandler(async (request: NextRequest, context: Context) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { workId } = await context.params
  const params = request.nextUrl.searchParams
  const result = await listMemberCandidates(authResult.session, {
    workId,
    keyword: params.get('keyword'),
    page: params.get('page'),
    pageSize: params.get('pageSize'),
    limit: params.get('limit'),
  })
  return NextResponse.json(result)
})
