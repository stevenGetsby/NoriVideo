import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { optionalConsumer, withConsumerTokenHeader } from '@/lib/mp/auth'
import { MpApiError } from '@/lib/mp/errors'
import { ingestEvents, MP_TRACK_LIMIT, trackAnonId } from '@/lib/mp/track'
import { checkRateLimit } from '@/lib/rate-limit'

export const runtime = 'nodejs'

export const POST = apiHandler(async (request: NextRequest) => {
  const auth = await optionalConsumer(request)
  let body: unknown
  try {
    body = await request.json()
  } catch {
    throw new MpApiError('MP_VALIDATION', { message: '请求格式无效' })
  }
  const anonId = trackAnonId(body)
  if (!anonId) throw new MpApiError('MP_VALIDATION', { message: '请求格式无效' })
  const rate = await checkRateLimit('mp:rl:track', anonId, MP_TRACK_LIMIT)
  if (rate.limited) throw new MpApiError('MP_RATE_LIMITED', { retryAfterSeconds: rate.retryAfterSeconds })
  await ingestEvents(body, auth?.consumer.id ?? null)
  return withConsumerTokenHeader(new NextResponse(null, { status: 204 }), auth)
})
