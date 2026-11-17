import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { listWorks } from '@/lib/mp/catalog'

export const runtime = 'nodejs'

export const GET = apiHandler(async (request: NextRequest) => {
  const params = request.nextUrl.searchParams
  const data = await listWorks({
    sort: params.get('sort'),
    tag: params.get('tag'),
    cursor: params.get('cursor'),
    limit: params.get('limit'),
  })
  return NextResponse.json(data)
})
