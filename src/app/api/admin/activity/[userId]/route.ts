import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { forbidden, isErrorResponse, notFound, requireAdminAuth } from '@/lib/api-auth'
import { logInfo } from '@/lib/logging/core'
import { normalizeAccountRole } from '@/lib/account/permissions'
import { getActivityDetail } from '@/lib/account/activity-stats'
import { parseActivityRange } from '@/lib/account/activity-stats-shared'

const NO_STORE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  Pragma: 'no-cache',
}

export const GET = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ userId: string }> },
) => {
  const authResult = await requireAdminAuth()
  if (isErrorResponse(authResult)) return authResult

  if (normalizeAccountRole(authResult.session.user.role) !== 'admin') {
    return forbidden('仅管理员可以查看工作监督。')
  }

  const managerId = authResult.session.user.actorId || authResult.session.user.id
  const { userId } = await context.params
  const range = parseActivityRange(request.nextUrl.searchParams.get('range'))
  if (!range) {
    throw new ApiError('INVALID_PARAMS', { message: 'range 只能是 today、7d 或 30d。' })
  }

  const detail = await getActivityDetail(managerId, userId, range)
  if (!detail) return notFound('Account')

  logInfo('[ActivityAudit] view', { operatorUserId: managerId, targetUserId: userId, range })
  return NextResponse.json(detail, { headers: NO_STORE_HEADERS })
})
