import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, getIdempotencyKey, getRequestId } from '@/lib/api-errors'
import { isErrorResponse, requireUserPermission } from '@/lib/api-auth'
import { MpApiError } from '@/lib/mp/errors'
import { createRelease, requirePublishAccess } from '@/lib/mp/publish'
import { resolveRequiredTaskLocale } from '@/lib/task/resolve-locale'

type RouteContext = { params: Promise<{ workId: string }> }

export const POST = apiHandler(async (request: NextRequest, context: RouteContext) => {
  const authResult = await requireUserPermission(['canvasWrite'])
  if (isErrorResponse(authResult)) return authResult
  const { workId } = await context.params
  await requirePublishAccess(authResult.session, workId)
  const idempotencyKey = getIdempotencyKey(request)
  if (!idempotencyKey) throw new MpApiError('MP_VALIDATION', { message: '缺少 Idempotency-Key 请求头' })
  const body = await request.json().catch(() => null) as { note?: unknown } | null
  const note = typeof body?.note === 'string' ? body.note.trim() : ''
  const result = await createRelease({
    session: authResult.session,
    workId,
    note,
    idempotencyKey,
    locale: resolveRequiredTaskLocale(request, body),
    requestId: getRequestId(request),
  })
  return NextResponse.json(result, { status: 202 })
})
