import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { optionalConsumer, withConsumerTokenHeader } from '@/lib/mp/auth'
import { workDetail } from '@/lib/mp/catalog'

export const runtime = 'nodejs'

type RouteContext = { params: Promise<{ slug: string }> }

export const GET = apiHandler(async (request: NextRequest, context: RouteContext) => {
  const { slug } = await context.params
  const auth = await optionalConsumer(request)
  const data = await workDetail(decodeURIComponent(slug), auth?.consumer.id ?? null)
  return withConsumerTokenHeader(NextResponse.json(data), auth)
})
