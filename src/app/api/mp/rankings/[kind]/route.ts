import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { ranking } from '@/lib/mp/catalog'

export const runtime = 'nodejs'

type RouteContext = { params: Promise<{ kind: string }> }

export const GET = apiHandler(async (_request: NextRequest, context: RouteContext) => {
  const { kind } = await context.params
  return NextResponse.json(await ranking(kind))
})
