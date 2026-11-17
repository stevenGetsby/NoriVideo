import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { requireConsumerAuth, withConsumerTokenHeader } from '@/lib/mp/auth'
import { reservationCards } from '@/lib/mp/catalog'

export const runtime = 'nodejs'

export const GET = apiHandler(async (request: NextRequest) => {
  const auth = await requireConsumerAuth(request)
  const data = await reservationCards(auth.consumer.id)
  return withConsumerTokenHeader(NextResponse.json(data), auth)
})
