import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { requireConsumerAuth, withConsumerTokenHeader } from '@/lib/mp/auth'
import { MpApiError } from '@/lib/mp/errors'
import { MP_WXACODE_LIMIT, shareWxacode } from '@/lib/mp/shares'
import { checkRateLimit } from '@/lib/rate-limit'

export const runtime = 'nodejs'

export const POST = apiHandler(async (request: NextRequest) => {
  const auth = await requireConsumerAuth(request)
  const rate = await checkRateLimit('mp:rl:wxacode', auth.consumer.id, MP_WXACODE_LIMIT)
  if (rate.limited) throw new MpApiError('MP_RATE_LIMITED', { retryAfterSeconds: rate.retryAfterSeconds })
  let body: { shareId?: unknown }
  try {
    body = await request.json() as typeof body
  } catch {
    throw new MpApiError('MP_VALIDATION', { message: '请求格式无效' })
  }
  const data = await shareWxacode(auth.consumer.id, body.shareId)
  return withConsumerTokenHeader(NextResponse.json(data), auth)
})
