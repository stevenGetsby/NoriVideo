import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { forbidden, isErrorResponse, requireAdminAuth } from '@/lib/api-auth'
import { logInfo } from '@/lib/logging/core'
import { normalizeAccountRole } from '@/lib/account/permissions'
import { getActivityOverview } from '@/lib/account/activity-stats'
import {
  buildActivityCsv,
  parseActivityRange,
  shanghaiDateKey,
} from '@/lib/account/activity-stats-shared'

const NO_STORE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  Pragma: 'no-cache',
}

export const GET = apiHandler(async (request: NextRequest) => {
  const authResult = await requireAdminAuth()
  if (isErrorResponse(authResult)) return authResult

  // 工作监督只对管理员开放；平台超管与项目组长都不可见。
  if (normalizeAccountRole(authResult.session.user.role) !== 'admin') {
    return forbidden('仅管理员可以查看工作监督。')
  }

  const managerId = authResult.session.user.actorId || authResult.session.user.id
  const range = parseActivityRange(request.nextUrl.searchParams.get('range'))
  if (!range) {
    throw new ApiError('INVALID_PARAMS', { message: 'range 只能是 today、7d 或 30d。' })
  }

  const overview = await getActivityOverview(managerId, range)

  if (request.nextUrl.searchParams.get('format') === 'csv') {
    logInfo('[ActivityAudit] export', { operatorUserId: managerId, range, accounts: overview.rows.length })
    return new NextResponse(buildActivityCsv(overview), {
      headers: {
        ...NO_STORE_HEADERS,
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="work-activity-${range}-${shanghaiDateKey(new Date())}.csv"`,
      },
    })
  }

  return NextResponse.json(overview, { headers: NO_STORE_HEADERS })
})
