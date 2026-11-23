import { apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireAdminAuth } from '@/lib/api-auth'
import { listWorkCandidates } from '@/lib/compute-ledger/projects'
import { json, adminLedgerCtx } from '@/lib/compute-ledger/route-helpers'

export const GET = apiHandler(async () => {
  const session = await requireAdminAuth()
  if (isErrorResponse(session)) return session
  const auth = adminLedgerCtx(session.session)
  return json({ works: await listWorkCandidates(auth.ctx) })
})
