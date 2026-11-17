import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireSuperAdminAuth } from '@/lib/api-auth'
import { renewOpsChannelUrlLink } from '@/lib/mp/channels'

export const runtime = 'nodejs'

type RouteContext = { params: Promise<{ id: string }> }

// 复制外链前调用：剩余有效期不足 1 天时自动续期（同 H.4）。
export const POST = apiHandler(async (_request: NextRequest, context: RouteContext) => {
  const authResult = await requireSuperAdminAuth()
  if (isErrorResponse(authResult)) return authResult
  const { id } = await context.params
  return NextResponse.json(await renewOpsChannelUrlLink(id))
})
