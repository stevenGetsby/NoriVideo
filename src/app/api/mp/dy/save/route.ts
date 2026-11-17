import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { assertUserApp, DY_SAVE_LIMIT, dyAppIdOf, requireDyUser, withDyTokenHeader } from '@/lib/mp/dy/auth'
import { getDySave, putDySave } from '@/lib/mp/dy/saves'
import { MP_SAVE_MAX_BYTES } from '@/lib/mp/constants'
import { MpApiError } from '@/lib/mp/errors'
import type { SavePutBody } from '@/lib/mp/library'
import { checkRateLimit } from '@/lib/rate-limit'

export const runtime = 'nodejs'

export const GET = apiHandler(async (request: NextRequest) => {
  const appId = dyAppIdOf(request)
  const auth = await requireDyUser(request)
  assertUserApp(auth.user, appId)
  const rate = await checkRateLimit('mp:rl:dysave', auth.user.id, DY_SAVE_LIMIT)
  if (rate.limited) throw new MpApiError('MP_RATE_LIMITED', { retryAfterSeconds: rate.retryAfterSeconds })
  const data = await getDySave(auth.user)
  return withDyTokenHeader(NextResponse.json(data), auth)
})

export const PUT = apiHandler(async (request: NextRequest) => {
  const appId = dyAppIdOf(request)
  const auth = await requireDyUser(request)
  assertUserApp(auth.user, appId)
  const rate = await checkRateLimit('mp:rl:dysave', auth.user.id, DY_SAVE_LIMIT)
  if (rate.limited) throw new MpApiError('MP_RATE_LIMITED', { retryAfterSeconds: rate.retryAfterSeconds })
  const text = await request.text()
  if (Buffer.byteLength(text, 'utf8') > MP_SAVE_MAX_BYTES) throw new MpApiError('MP_PAYLOAD_TOO_LARGE')
  let body: SavePutBody
  try {
    body = JSON.parse(text) as SavePutBody
  } catch {
    throw new MpApiError('MP_VALIDATION', { message: '存档格式无效' })
  }
  const data = await putDySave(auth.user, body)
  return withDyTokenHeader(NextResponse.json(data), auth)
})