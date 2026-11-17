import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { requireConsumerAuth, withConsumerTokenHeader } from '@/lib/mp/auth'
import { addSubscription } from '@/lib/mp/library'
import { MpApiError } from '@/lib/mp/errors'

export const runtime = 'nodejs'

export const POST = apiHandler(async (request: NextRequest) => {
  const auth = await requireConsumerAuth(request)
  let body: { slug?: unknown; kind?: unknown; accepted?: unknown }
  try {
    body = await request.json() as typeof body
  } catch {
    throw new MpApiError('MP_VALIDATION', { message: '请求格式无效' })
  }
  if (typeof body.slug !== 'string' || !body.slug.trim()) throw new MpApiError('MP_VALIDATION', { message: '缺少作品参数' })
  const data = await addSubscription(body.slug.trim(), auth.consumer.id, body.kind, body.accepted)
  return withConsumerTokenHeader(NextResponse.json(data), auth)
})
