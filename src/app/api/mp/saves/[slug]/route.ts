import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { requireConsumerAuth, withConsumerTokenHeader } from '@/lib/mp/auth'
import { MP_SAVE_MAX_BYTES } from '@/lib/mp/constants'
import { MpApiError } from '@/lib/mp/errors'
import { MP_SAVE_LIMIT, getSave, putSave, type SavePutBody } from '@/lib/mp/library'
import { checkRateLimit } from '@/lib/rate-limit'

export const runtime = 'nodejs'

type RouteContext = { params: Promise<{ slug: string }> }

export const GET = apiHandler(async (request: NextRequest, context: RouteContext) => {
  const { slug } = await context.params
  const auth = await requireConsumerAuth(request)
  const data = await getSave(decodeURIComponent(slug), auth.consumer.id)
  return withConsumerTokenHeader(NextResponse.json(data), auth)
})

export const PUT = apiHandler(async (request: NextRequest, context: RouteContext) => {
  const { slug } = await context.params
  const auth = await requireConsumerAuth(request)
  const rate = await checkRateLimit('mp:rl:save', auth.consumer.id, MP_SAVE_LIMIT)
  if (rate.limited) throw new MpApiError('MP_RATE_LIMITED', { retryAfterSeconds: rate.retryAfterSeconds })
  const text = await request.text()
  if (Buffer.byteLength(text, 'utf8') > MP_SAVE_MAX_BYTES) throw new MpApiError('MP_PAYLOAD_TOO_LARGE')
  let body: SavePutBody
  try {
    body = JSON.parse(text) as SavePutBody
  } catch {
    throw new MpApiError('MP_VALIDATION', { message: '存档格式无效' })
  }
  const data = await putSave(decodeURIComponent(slug), auth.consumer.id, body)
  return withConsumerTokenHeader(NextResponse.json(data), auth)
})
