import { NextRequest } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireAdminAuth } from '@/lib/api-auth'
import { rollbackImport } from '@/lib/compute-ledger/import-service'
import { json, adminLedgerCtx } from '@/lib/compute-ledger/route-helpers'

export const POST = apiHandler(async (request: NextRequest) => {
  const session = await requireAdminAuth()
  if (isErrorResponse(session)) return session
  const auth = adminLedgerCtx(session.session)
  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const batchId = typeof body.batchId === 'string' ? body.batchId.trim() : ''
  if (!batchId || batchId.length > 64) throw new ApiError('INVALID_PARAMS', { message: 'batchId 非法。' })
  return json(await rollbackImport(auth.ctx, batchId))
})
