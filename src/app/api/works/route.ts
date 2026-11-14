import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'
import { createWork, listWorks } from '@/lib/works/service'

const PRODUCT_LINE_VALUES = new Set(['canvas', 'story', 'all'])

export const GET = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const params = request.nextUrl.searchParams
  const productLine = params.get('productLine')
  if (productLine !== null && !PRODUCT_LINE_VALUES.has(productLine)) {
    throw new ApiError('INVALID_PARAMS', { message: 'productLine 只能是 canvas、story 或 all。' })
  }
  const result = await listWorks(authResult.session, {
    page: params.get('page'),
    pageSize: params.get('pageSize'),
    search: params.get('search'),
    ...(productLine !== null ? { productLine } : {}),
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
  return NextResponse.json({ project: { ...work, kind: 'project' }, work }, { status: 201 })
})
