import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { releaseStats } from '@/lib/mp/stats'

export const runtime = 'nodejs'

type RouteContext = { params: Promise<{ releaseId: string }> }

export const GET = apiHandler(async (_request: NextRequest, context: RouteContext) => {
  const { releaseId } = await context.params
  return NextResponse.json(await releaseStats(releaseId))
})
