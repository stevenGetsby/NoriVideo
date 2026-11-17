import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { requireConsumerAuth, withConsumerTokenHeader } from '@/lib/mp/auth'
import { setFavorite } from '@/lib/mp/library'

export const runtime = 'nodejs'

type RouteContext = { params: Promise<{ slug: string }> }

export const PUT = apiHandler(async (request: NextRequest, context: RouteContext) => {
  const { slug } = await context.params
  const auth = await requireConsumerAuth(request)
  const data = await setFavorite(decodeURIComponent(slug), auth.consumer.id, true)
  return withConsumerTokenHeader(NextResponse.json(data), auth)
})

export const DELETE = apiHandler(async (request: NextRequest, context: RouteContext) => {
  const { slug } = await context.params
  const auth = await requireConsumerAuth(request)
  const data = await setFavorite(decodeURIComponent(slug), auth.consumer.id, false)
  return withConsumerTokenHeader(NextResponse.json(data), auth)
})
