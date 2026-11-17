import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { topicDetail } from '@/lib/mp/catalog'

export const runtime = 'nodejs'

type RouteContext = { params: Promise<{ slug: string }> }

export const GET = apiHandler(async (_request: NextRequest, context: RouteContext) => {
  const { slug } = await context.params
  return NextResponse.json(await topicDetail(decodeURIComponent(slug)))
})
