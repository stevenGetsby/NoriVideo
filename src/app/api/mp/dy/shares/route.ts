import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { assertUserApp, DY_SHARE_LIMIT, dyAppIdOf, requireDyUser, withDyTokenHeader } from '@/lib/mp/dy/auth'
import { registerDyShare } from '@/lib/mp/dy/shares'
import { MpApiError } from '@/lib/mp/errors'
import { checkRateLimit } from '@/lib/rate-limit'

export const runtime = 'nodejs'

export const POST = apiHandler(async (request: NextRequest) => {
  const appId = dyAppIdOf(request)
  const auth = await requireDyUser(request)
  assertUserApp(auth.user, appId)
  const rate = await checkRateLimit('mp:rl:dyshare', auth.user.id, DY_SHARE_LIMIT)
  if (rate.limited) throw new MpApiError('MP_RATE_LIMITED', { retryAfterSeconds: rate.retryAfterSeconds })
  const body = await request.json().catch(() => ({}))
  const data = await registerDyShare(auth.user, body)
  return withDyTokenHeader(NextResponse.json(data), auth)
})