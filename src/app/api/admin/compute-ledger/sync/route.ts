import { NextRequest } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireAdminAuth } from '@/lib/api-auth'
import { logInfo } from '@/lib/logging/core'
import { syncPlatformFacts } from '@/lib/compute-ledger/sync'
import { json, adminLedgerCtx } from '@/lib/compute-ledger/route-helpers'

export const POST = apiHandler(async (request: NextRequest) => {
  const session = await requireAdminAuth()
  if (isErrorResponse(session)) return session
  const auth = adminLedgerCtx(session.session)
  const refresh = request.nextUrl.searchParams.get('refresh') !== '0'
  const result = await syncPlatformFacts(auth.ctx.ownerId, { refresh, maxChunks: 6 })
  logInfo('[LedgerAudit] sync', { operator: auth.ctx.actorId, complete: result.complete, syncedThroughDate: result.syncedThroughDate })
  return json(result)
})