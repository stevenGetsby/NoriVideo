import { NextRequest } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireAdminAuth } from '@/lib/api-auth'
import { CATEGORIES, PROJECT_STATUSES, type Category, type ProjectStatus } from '@/lib/compute-ledger/calc'
import { buildOverviewCsv } from '@/lib/compute-ledger/csv'
import { getOverview } from '@/lib/compute-ledger/overview'
import { csvResponse, json, adminLedgerCtx, parseDateRange } from '@/lib/compute-ledger/route-helpers'

export const GET = apiHandler(async (request: NextRequest) => {
  const session = await requireAdminAuth()
  if (isErrorResponse(session)) return session
  const auth = adminLedgerCtx(session.session)
  const params = request.nextUrl.searchParams
  const { from, to } = parseDateRange(params)

  const categoryRaw = params.get('category')
  const category = categoryRaw ? (CATEGORIES as readonly string[]).includes(categoryRaw) ? categoryRaw as Category : null : null
  if (categoryRaw && !category) throw new ApiError('INVALID_PARAMS', { message: 'category 取值非法。' })
  const statusRaw = params.get('status')
  const status = statusRaw ? (PROJECT_STATUSES as readonly string[]).includes(statusRaw) ? statusRaw as ProjectStatus : null : null
  if (statusRaw && !status) throw new ApiError('INVALID_PARAMS', { message: 'status 取值非法。' })

  const overview = await getOverview(auth.ctx.ownerId, {
    from,
    to,
    category,
    status,
    includeArchived: params.get('includeArchived') === '1',
    refresh: params.get('refresh') === '1',
  })
  if (params.get('format') === 'csv') {
    return csvResponse(`compute-ledger-overview-${from ?? 'all'}_${to ?? 'all'}.csv`, buildOverviewCsv(overview.rows))
  }
  return json(overview)
})