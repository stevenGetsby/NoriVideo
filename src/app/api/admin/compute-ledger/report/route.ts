import { NextRequest } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireAdminAuth } from '@/lib/api-auth'
import type { DayReportRow, TriReportRow, WeekReportRow } from '@/lib/compute-ledger/aggregate'
import { buildDayCsv, buildTriCsv, buildWeekCsv } from '@/lib/compute-ledger/csv'
import { getReport, getReportFull, type ReportView } from '@/lib/compute-ledger/report'
import { csvResponse, json, adminLedgerCtx, parseDateRange } from '@/lib/compute-ledger/route-helpers'

const VIEWS: readonly ReportView[] = ['day', 'week', 'tri']

export const GET = apiHandler(async (request: NextRequest) => {
  const session = await requireAdminAuth()
  if (isErrorResponse(session)) return session
  const auth = adminLedgerCtx(session.session)
  const params = request.nextUrl.searchParams

  const viewRaw = params.get('view') ?? 'day'
  if (!(VIEWS as readonly string[]).includes(viewRaw)) throw new ApiError('INVALID_PARAMS', { message: 'view 只能是 day / week / tri。' })
  const view = viewRaw as ReportView
  const { from, to } = parseDateRange(params)

  const pageRaw = params.get('page')
  const pageSizeRaw = params.get('pageSize')
  const page = pageRaw ? Number(pageRaw) : undefined
  const pageSize = pageSizeRaw ? Number(pageSizeRaw) : undefined
  if (page !== undefined && (!Number.isInteger(page) || page < 1)) throw new ApiError('INVALID_PARAMS', { message: 'page 必须是正整数。' })
  if (pageSize !== undefined && (!Number.isInteger(pageSize) || pageSize < 1)) throw new ApiError('INVALID_PARAMS', { message: 'pageSize 必须是正整数。' })

  const query = { view, from, to, projectId: params.get('projectId'), actorKey: params.get('actorKey'), page, pageSize }

  if (params.get('format') === 'csv') {
    const full = await getReportFull(auth.ctx.ownerId, query)
    const content = full.view === 'day'
      ? buildDayCsv(full.rows as DayReportRow[])
      : full.view === 'week'
        ? buildWeekCsv(full.rows as WeekReportRow[])
        : buildTriCsv(full.rows as TriReportRow[])
    return csvResponse(`compute-ledger-${full.view}-${full.range.from}_${full.range.to}.csv`, content)
  }

  return json(await getReport(auth.ctx.ownerId, query))
})
