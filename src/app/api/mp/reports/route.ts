import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { requireConsumerAuth, withConsumerTokenHeader } from '@/lib/mp/auth'
import { MpApiError } from '@/lib/mp/errors'
import { MP_REPORT_LIMIT, createReport } from '@/lib/mp/library'
import { checkRateLimit } from '@/lib/rate-limit'

export const runtime = 'nodejs'

export const POST = apiHandler(async (request: NextRequest) => {
  const auth = await requireConsumerAuth(request)
  const rate = await checkRateLimit('mp:rl:report', auth.consumer.id, MP_REPORT_LIMIT)
  if (rate.limited) throw new MpApiError('MP_RATE_LIMITED', { retryAfterSeconds: rate.retryAfterSeconds })
  const body = await request.json().catch(() => ({})) as { slug?: unknown; reason?: unknown; detail?: unknown }
  const slug = typeof body.slug === 'string' ? body.slug : ''
  const data = await createReport(slug, auth.consumer.id, body.reason, body.detail)
  return withConsumerTokenHeader(NextResponse.json(data), auth)
})
