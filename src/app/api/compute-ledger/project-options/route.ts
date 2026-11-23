import { apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'
import { toMoneyNumber } from '@/lib/billing/money'
import { listProjectOptions } from '@/lib/compute-ledger/projects'
import { getOrCreateSetting } from '@/lib/compute-ledger/sync'
import { json, memberLedgerCtx } from '@/lib/compute-ledger/route-helpers'

export const GET = apiHandler(async () => {
  const session = await requireUserAuth()
  if (isErrorResponse(session)) return session
  const auth = memberLedgerCtx(session.session)
  const [projects, setting] = await Promise.all([
    listProjectOptions(auth.ctx),
    getOrCreateSetting(auth.ctx.ownerId),
  ])
  return json({
    projects,
    rates: {
      tokenRateCnyPerMillion: toMoneyNumber(setting.tokenRateCnyPerMillion),
      jimengCnyPerPoint: toMoneyNumber(setting.jimengCnyPerPoint),
    },
  })
})
