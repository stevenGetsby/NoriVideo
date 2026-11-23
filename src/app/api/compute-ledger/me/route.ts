import { NextRequest } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'
import { getMe } from '@/lib/compute-ledger/me'
import { json, memberLedgerCtx, parseDateRange } from '@/lib/compute-ledger/route-helpers'

export const GET = apiHandler(async (request: NextRequest) => {
  const session = await requireUserAuth()
  if (isErrorResponse(session)) return session
  const auth = memberLedgerCtx(session.session)
  const { from, to } = parseDateRange(request.nextUrl.searchParams, { maxDays: 93 })
  return json(await getMe(auth.ctx, from, to))
})
