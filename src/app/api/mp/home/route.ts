import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { optionalConsumer, withConsumerTokenHeader } from '@/lib/mp/auth'
import { home } from '@/lib/mp/catalog'

export const runtime = 'nodejs'

export const GET = apiHandler(async (request: NextRequest) => {
  const auth = await optionalConsumer(request)
  const data = await home(auth?.consumer.id ?? null)
  return withConsumerTokenHeader(NextResponse.json(data), auth)
})
