import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { requireConsumerAuth, withConsumerTokenHeader } from '@/lib/mp/auth'
import { setRating } from '@/lib/mp/library'

export const runtime = 'nodejs'

type RouteContext = { params: Promise<{ slug: string }> }

export const PUT = apiHandler(async (request: NextRequest, context: RouteContext) => {
  const { slug } = await context.params
  const auth = await requireConsumerAuth(request)
  const body = await request.json().catch(() => ({})) as { score?: unknown }
  const data = await setRating(decodeURIComponent(slug), auth.consumer.id, body.score)
  return withConsumerTokenHeader(NextResponse.json(data), auth)
})
