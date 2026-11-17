import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { requireConsumerAuth, withConsumerTokenHeader } from '@/lib/mp/auth'
import { playManifest } from '@/lib/mp/catalog'

export const runtime = 'nodejs'

type RouteContext = { params: Promise<{ slug: string }> }

export const GET = apiHandler(async (request: NextRequest, context: RouteContext) => {
  const { slug } = await context.params
  const auth = await requireConsumerAuth(request)
  const data = await playManifest(decodeURIComponent(slug), auth.consumer.id)
  return withConsumerTokenHeader(NextResponse.json(data), auth)
})
