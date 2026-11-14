import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError, getIdempotencyKey } from '@/lib/api-errors'
import { forbidden, isErrorResponse, requireUserAuth } from '@/lib/api-auth'
import { isSubaccountRole, normalizeAccountRole } from '@/lib/account/permissions'
import { isDirectSubaccountOf, managedAccountSelect } from '@/lib/account/management'
import { allocateAccountPointsBulk, CreditLedgerError } from '@/lib/billing/credit-ledger'
import { prisma } from '@/lib/prisma'
import { logInfo } from '@/lib/logging/core'

export const POST = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const operatorId = authResult.session.user.actorId || authResult.session.user.id
  const operatorRole = normalizeAccountRole(authResult.session.user.role)
  if (operatorRole !== 'admin') return forbidden('只有管理账号可以批量分配积分。')

  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  if (!Number.isSafeInteger(body.points) || Number(body.points) <= 0 || Number(body.points) > 2_000_000_000) {
    throw new ApiError('INVALID_PARAMS', { message: '积分必须是 1–2000000000 的整数。' })
  }
  if (!Array.isArray(body.userIds) || body.userIds.some((id) => typeof id !== 'string' || !id.trim())) {
    throw new ApiError('INVALID_PARAMS', { message: '请选择要分配积分的子账号。' })
  }
  const userIds = Array.from(new Set(body.userIds.map((id) => id.trim())))
  if (userIds.length < 1 || userIds.length > 100) {
    throw new ApiError('INVALID_PARAMS', { message: '一次请选择 1–100 个子账号。' })
  }
  if (body.note !== undefined && (typeof body.note !== 'string' || body.note.trim().length > 200)) {
    throw new ApiError('INVALID_PARAMS', { message: '备注不能超过 200 个字符。' })
  }
  const requestedKey = body.idempotencyKey ?? getIdempotencyKey(request)
  if (typeof requestedKey !== 'string' || !requestedKey.trim() || requestedKey.trim().length > 64) {
    throw new ApiError('INVALID_PARAMS', { message: '请求编号不能为空且不能超过 64 个字符。' })
  }
  const idempotencyKey = requestedKey.trim()

  const targets = await prisma.user.findMany({
    where: { id: { in: userIds }, status: 'active' },
    select: managedAccountSelect,
  })
  const byId = new Map(targets.map((target) => [target.id, target]))
  if (userIds.some((id) => {
    const target = byId.get(id)
    return !target || !isSubaccountRole(normalizeAccountRole(target.role)) || !isDirectSubaccountOf(target, operatorId)
  })) {
    return forbidden('批量分配只能包含自己的直属启用子账号；请刷新后重新选择。')
  }

  try {
    const result = await allocateAccountPointsBulk({
      operatorId,
      targetUserIds: userIds,
      points: Number(body.points),
      idempotencyKey,
      note: typeof body.note === 'string' ? body.note.trim() || null : null,
    })
    logInfo('[AccountCredits] 批量分配完成', {
      operatorUserId: operatorId,
      count: userIds.length,
      points: Number(body.points),
      idempotencyKey,
    })
    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    if (error instanceof CreditLedgerError) {
      if (error.code === 'INSUFFICIENT_POINTS') {
        throw new ApiError('INSUFFICIENT_BALANCE', { message: error.message, required: Number(body.points) * userIds.length })
      }
      throw new ApiError('INVALID_PARAMS', { message: error.message })
    }
    throw error
  }
})
