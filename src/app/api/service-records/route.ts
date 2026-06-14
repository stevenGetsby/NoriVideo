import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler } from '@/lib/api-errors'
import { buildServiceRecordsOverview } from '@/lib/workspace/service-records'

function parseLimit(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get('limit')
  if (!raw) return undefined
  const limit = Number.parseInt(raw, 10)
  return Number.isFinite(limit) ? limit : undefined
}

export const GET = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult

  const overview = await buildServiceRecordsOverview(authResult.session.user.id, {
    limit: parseLimit(request),
  })
  return NextResponse.json(overview)
})
