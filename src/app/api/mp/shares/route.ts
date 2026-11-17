import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { requireConsumerAuth, withConsumerTokenHeader } from '@/lib/mp/auth'
import { MpApiError } from '@/lib/mp/errors'
import { MP_SHARE_LIMIT, registerShare } from '@/lib/mp/shares'
import { checkRateLimit } from '@/lib/rate-limit'

export const runtime = 'nodejs'

export const POST = apiHandler(async (request: NextRequest) => {
  const auth = await requireConsumerAuth(request)
  const rate = await checkRateLimit('mp:rl:share', auth.consumer.id, MP_SHARE_LIMIT)
  if (rate.limited) throw new MpApiError('MP_RATE_LIMITED', { retryAfterSeconds: rate.retryAfterSeconds })
  let body: { id?: unknown; slug?: unknown; kind?: unknown; endingNodeId?: unknown }
  try {
    body = await request.json() as typeof body
  } catch {
    throw new MpApiError('MP_VALIDATION', { message: '请求格式无效' })
  }
  const data = await registerShare(auth.consumer.id, body)
  return withConsumerTokenHeader(NextResponse.json(data), auth)
})
