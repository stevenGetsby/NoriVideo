import { NextRequest } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireAdminAuth } from '@/lib/api-auth'
import type { ImportPayload } from '@/lib/compute-ledger/import-plan'
import { runImport } from '@/lib/compute-ledger/import-service'
import { json, adminLedgerCtx } from '@/lib/compute-ledger/route-helpers'

const MAX_BODY_BYTES = 2 * 1024 * 1024
const MAX_ROWS = 20000

export const POST = apiHandler(async (request: NextRequest) => {
  const session = await requireAdminAuth()
  if (isErrorResponse(session)) return session
  const auth = adminLedgerCtx(session.session)

  const text = await request.text()
  if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) {
    throw new ApiError('INVALID_PARAMS', { message: '请求体超过 2 MB。' })
  }
  let body: Record<string, unknown>
  try {
    body = JSON.parse(text) as Record<string, unknown>
  } catch {
    throw new ApiError('INVALID_PARAMS', { message: '请求体不是合法 JSON。' })
  }

  const mode = body.mode
  if (mode !== 'dry-run' && mode !== 'commit') throw new ApiError('INVALID_PARAMS', { message: 'mode 只能是 dry-run 或 commit。' })
  const carryForward = body.carryForward
  if (carryForward !== 'none' && carryForward !== 'stated-total') throw new ApiError('INVALID_PARAMS', { message: 'carryForward 只能是 none 或 stated-total。' })
  const acknowledgeOverlap = body.acknowledgeOverlap === true
  const expectedHash = typeof body.expectedHash === 'string' ? body.expectedHash : undefined

  const payload = body.payload as ImportPayload | undefined
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.rows)) {
    throw new ApiError('INVALID_PARAMS', { message: 'payload.rows 必须是数组。' })
  }
  if (payload.rows.length > MAX_ROWS) throw new ApiError('INVALID_PARAMS', { message: `单次导入不能超过 ${MAX_ROWS} 行。` })
  for (const row of payload.rows) {
    if (row == null || typeof row !== 'object') throw new ApiError('INVALID_PARAMS', { message: 'payload.rows 中存在非法行。' })
  }

  const report = await runImport(auth.ctx, { mode, carryForward, acknowledgeOverlap, expectedHash, payload })
  return json(report)
})
