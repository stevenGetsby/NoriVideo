import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { getDyApp } from '@/lib/mp/dy/apps'
import { DY_TRACK_LIMIT, dyAppIdOf, optionalDyUser, withDyTokenHeader } from '@/lib/mp/dy/auth'
import { ingestDyEvents } from '@/lib/mp/dy/events'
import { MpApiError } from '@/lib/mp/errors'
import { trackAnonId } from '@/lib/mp/track'
import { checkRateLimit } from '@/lib/rate-limit'

export const runtime = 'nodejs'

export const POST = apiHandler(async (request: NextRequest) => {
  const appId = dyAppIdOf(request)
  await getDyApp(appId)
  const auth = await optionalDyUser(request)
  // 跨 app 的 token 不算登录，事件按匿名记录。
  const userId = auth && auth.user.appId === appId ? auth.user.id : null
  let body: unknown
  try {
    body = await request.json()
  } catch {
    throw new MpApiError('MP_VALIDATION', { message: '请求格式无效' })
  }
  const anonId = trackAnonId(body)
  if (!anonId) throw new MpApiError('MP_VALIDATION', { message: '请求格式无效' })
  const rate = await checkRateLimit('mp:rl:dytrack', anonId, DY_TRACK_LIMIT)
  if (rate.limited) throw new MpApiError('MP_RATE_LIMITED', { retryAfterSeconds: rate.retryAfterSeconds })
  await ingestDyEvents(appId, body, userId)
  return withDyTokenHeader(new NextResponse(null, { status: 204 }), auth)
})