import { NextRequest } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireAdminAuth } from '@/lib/api-auth'
import { getSettings, updateSettings } from '@/lib/compute-ledger/settings'
import { json, adminLedgerCtx } from '@/lib/compute-ledger/route-helpers'

export const GET = apiHandler(async () => {
  const session = await requireAdminAuth()
  if (isErrorResponse(session)) return session
  const auth = adminLedgerCtx(session.session)
  return json(await getSettings(auth.ctx.ownerId))
})

export const PATCH = apiHandler(async (request: NextRequest) => {
  const session = await requireAdminAuth()
  if (isErrorResponse(session)) return session
  const auth = adminLedgerCtx(session.session)
  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const input: { tokenRateCnyPerMillion?: number; jimengCnyPerPoint?: number } = {}
  if (body.tokenRateCnyPerMillion !== undefined) {
    if (typeof body.tokenRateCnyPerMillion !== 'number') throw new ApiError('INVALID_PARAMS', { message: 'API token 单价必须是数字。' })
    input.tokenRateCnyPerMillion = body.tokenRateCnyPerMillion
  }
  if (body.jimengCnyPerPoint !== undefined) {
    if (typeof body.jimengCnyPerPoint !== 'number') throw new ApiError('INVALID_PARAMS', { message: '即梦积分单价必须是数字。' })
    input.jimengCnyPerPoint = body.jimengCnyPerPoint
  }
  return json(await updateSettings(auth.ctx, input))
})
