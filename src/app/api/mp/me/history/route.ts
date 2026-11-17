import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { requireConsumerAuth, withConsumerTokenHeader } from '@/lib/mp/auth'
import { historyCards } from '@/lib/mp/catalog'

export const runtime = 'nodejs'

export const GET = apiHandler(async (request: NextRequest) => {
  const auth = await requireConsumerAuth(request)
  const params = request.nextUrl.searchParams
  const data = await historyCards(auth.consumer.id, params.get('cursor'), params.get('limit'))
  return withConsumerTokenHeader(NextResponse.json(data), auth)
})
