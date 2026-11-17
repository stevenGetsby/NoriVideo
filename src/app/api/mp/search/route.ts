import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { MP_SEARCH_LIMIT, searchWorks } from '@/lib/mp/catalog'
import { MpApiError } from '@/lib/mp/errors'
import { checkRateLimit, getClientIp } from '@/lib/rate-limit'

export const runtime = 'nodejs'

export const GET = apiHandler(async (request: NextRequest) => {
  const rate = await checkRateLimit('mp:rl:search', getClientIp(request), MP_SEARCH_LIMIT)
  if (rate.limited) throw new MpApiError('MP_RATE_LIMITED', { retryAfterSeconds: rate.retryAfterSeconds })
  return NextResponse.json(await searchWorks(request.nextUrl.searchParams.get('q') ?? ''))
})
