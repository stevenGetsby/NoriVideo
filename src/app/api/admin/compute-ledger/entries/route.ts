import { NextRequest } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireAdminAuth } from '@/lib/api-auth'
import { ENTRY_KINDS, type EntryKind } from '@/lib/compute-ledger/calc'
import { listEntries } from '@/lib/compute-ledger/entries'
import { json, adminLedgerCtx, parseDateRange } from '@/lib/compute-ledger/route-helpers'

export const GET = apiHandler(async (request: NextRequest) => {
  const session = await requireAdminAuth()
  if (isErrorResponse(session)) return session
  const auth = adminLedgerCtx(session.session)
  const params = request.nextUrl.searchParams
  const { from, to } = parseDateRange(params)

  const kindRaw = params.get('kind')
  const kind = kindRaw ? ((ENTRY_KINDS as readonly string[]).includes(kindRaw) ? kindRaw as EntryKind : null) : null
  if (kindRaw && !kind) throw new ApiError('INVALID_PARAMS', { message: 'kind 取值非法。' })

  const pageRaw = params.get('page')
  const pageSizeRaw = params.get('pageSize')
  const page = pageRaw ? Number(pageRaw) : undefined
  const pageSize = pageSizeRaw ? Number(pageSizeRaw) : undefined
  if (page !== undefined && (!Number.isInteger(page) || page < 1)) throw new ApiError('INVALID_PARAMS', { message: 'page 必须是正整数。' })
  if (pageSize !== undefined && (!Number.isInteger(pageSize) || pageSize < 1)) throw new ApiError('INVALID_PARAMS', { message: 'pageSize 必须是正整数。' })

  const result = await listEntries(auth.ctx, {
    from,
    to,
    projectId: params.get('projectId'),
    actorKey: params.get('actorKey'),
    kind,
    source: params.get('source'),
    importBatchId: params.get('importBatchId'),
    includeVoided: params.get('includeVoided') === '1',
    page,
    pageSize,
  })
  return json(result)
})
