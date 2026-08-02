import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'
import { listMemberCandidates } from '@/lib/works/service'

export const GET = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const params = request.nextUrl.searchParams
  const result = await listMemberCandidates(authResult.session, {
    keyword: params.get('keyword'),
    page: params.get('page'),
    pageSize: params.get('pageSize'),
    limit: params.get('limit'),
  })
  return NextResponse.json(result)
})
