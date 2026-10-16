import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError, getIdempotencyKey } from '@/lib/api-errors'
import { forbidden, isErrorResponse, requireAdminAuth } from '@/lib/api-auth'
import { normalizeAccountRole, isSubaccountRole } from '@/lib/account/permissions'
import { isDirectSubaccountOf, managedAccountSelect, serializeManagedAccount } from '@/lib/account/management'
import {
  CreditLedgerError,
  reclaimAccountPoints,
  rechargeAccountPoints,
  type CreditOperation,
} from '@/lib/billing/credit-ledger'
import { prisma } from '@/lib/prisma'
import { logInfo } from '@/lib/logging/core'
import { cnyToPoints } from '@/lib/billing/credit-policy'
import { toMoneyNumber } from '@/lib/billing/money'

const MAX_OPERATION_POINTS = 2_000_000_000

function readOperation(value: unknown): CreditOperation {
  if (value === 'recharge' || value === 'allocate' || value === 'reclaim') return value
  throw new ApiError('INVALID_PARAMS', { message: '积分操作只能是充值、分配或收回。' })
}

function readPoints(value: unknown, operation: CreditOperation) {
  const pattern = operation === 'reclaim' ? /^\d+(?:\.\d{1,4})?$/ : /^\d+$/
  if (typeof value !== 'number' && !(typeof value === 'string' && pattern.test(value.trim()))) {
    throw new ApiError('INVALID_PARAMS', { message: operation === 'reclaim'
      ? '收回积分须为正数（最多 4 位小数），不能使用空值或布尔值。'
      : '积分必须是正整数，不能使用空值或布尔值。' })
  }
  const points = Number(value)
  const validPrecision = operation === 'reclaim'
    ? Number.isFinite(points) && Math.abs(points * 10_000 - Math.round(points * 10_000)) <= 0.00001
    : Number.isSafeInteger(points)
  if (!validPrecision || points <= 0 || points > MAX_OPERATION_POINTS) {
    throw new ApiError('INVALID_PARAMS', { message: operation === 'reclaim'
      ? `收回积分须为正数，最多 ${MAX_OPERATION_POINTS} 积分、4 位小数。`
      : `积分必须是 1–${MAX_OPERATION_POINTS} 的整数。` })
  }
  return points
}

function readOptionalText(value: unknown, maxLength: number) {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new ApiError('INVALID_PARAMS', { message: '备注格式无效。' })
  const normalized = value.trim()
  if (normalized.length > maxLength) throw new ApiError('INVALID_PARAMS', { message: `备注不能超过 ${maxLength} 个字符。` })
  return normalized || null
}

export const GET = apiHandler(async (
  _request: NextRequest,
  context: { params: Promise<{ userId: string }> },
) => {
  const authResult = await requireAdminAuth()
  if (isErrorResponse(authResult)) return authResult

  const operatorId = authResult.session.user.actorId || authResult.session.user.id
  const operatorRole = normalizeAccountRole(authResult.session.user.role)
  const { userId } = await context.params
  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: managedAccountSelect,
  })
  if (!target) throw new ApiError('NOT_FOUND', { message: '目标账号不存在。' })

  const targetRole = normalizeAccountRole(target.role)
  const allowed = target.id === operatorId
    || (operatorRole === 'super_admin' && targetRole === 'admin' && target.parentAccountId === operatorId)
    || (operatorRole === 'admin' && isSubaccountRole(targetRole) && isDirectSubaccountOf(target, operatorId))
  if (!allowed) return forbidden('只能查看自己直接管理账号的积分流水。')

  const [balance, transactions] = await Promise.all([
    prisma.userBalance.upsert({
      where: { userId: target.id },
      create: { userId: target.id, balance: 0, frozenAmount: 0, totalSpent: 0 },
      update: {},
    }),
    prisma.balanceTransaction.findMany({
      where: { userId: target.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        type: true,
        amount: true,
        balanceAfter: true,
        description: true,
        relatedId: true,
        operatorId: true,
        idempotencyKey: true,
        projectId: true,
        episodeId: true,
        taskType: true,
        createdAt: true,
      },
    }),
  ])

  return NextResponse.json({
    success: true,
    account: serializeManagedAccount({ ...target, balance: { balance: balance.balance } }),
    balance: {
      availableCny: toMoneyNumber(balance.balance),
      availablePoints: cnyToPoints(toMoneyNumber(balance.balance)),
      frozenCny: toMoneyNumber(balance.frozenAmount),
      frozenPoints: cnyToPoints(toMoneyNumber(balance.frozenAmount)),
      totalSpentCny: toMoneyNumber(balance.totalSpent),
      totalSpentPoints: cnyToPoints(toMoneyNumber(balance.totalSpent)),
    },
    transactions: transactions.map((transaction) => ({
      ...transaction,
      amountCny: toMoneyNumber(transaction.amount),
      amountPoints: cnyToPoints(toMoneyNumber(transaction.amount)),
      balanceAfterCny: toMoneyNumber(transaction.balanceAfter),
      balanceAfterPoints: cnyToPoints(toMoneyNumber(transaction.balanceAfter)),
      amount: undefined,
      balanceAfter: undefined,
      createdAt: transaction.createdAt.toISOString(),
    })),
  })
})

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ userId: string }> },
) => {
  const authResult = await requireAdminAuth()
  if (isErrorResponse(authResult)) return authResult

  const operatorId = authResult.session.user.actorId || authResult.session.user.id
  const operatorRole = normalizeAccountRole(authResult.session.user.role)
  const { userId } = await context.params
  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const operation = readOperation(body.operation)
  const points = readPoints(body.points, operation)
  const note = readOptionalText(body.note, 200)
  const requestedKey = readOptionalText(body.idempotencyKey ?? getIdempotencyKey(request), 128)
  const idempotencyKey = requestedKey || `credits:${operation}:${operatorId}:${userId}:${randomUUID()}`

  const target = await prisma.user.findFirst({
    where: { id: userId, status: { not: 'deleted' } },
    select: managedAccountSelect,
  })
  if (!target) throw new ApiError('NOT_FOUND', { message: '目标账号不存在。' })
  const targetRole = normalizeAccountRole(target.role)

  try {
    const result = operation === 'recharge'
      ? (() => {
          if (operatorRole !== 'super_admin' || targetRole !== 'admin' || target.parentAccountId !== operatorId) {
            return null
          }
          return rechargeAccountPoints(target.id, points, { operatorId, idempotencyKey, note })
        })()
      : (() => {
          if (
            operatorRole !== 'admin'
            || !isSubaccountRole(targetRole)
            || !isDirectSubaccountOf(target, operatorId)
          ) {
            return null
          }
          return operation === 'allocate'
            ? (() => { throw new ApiError('INVALID_PARAMS', {
                message: '子账号使用管理账号共享钱包，请通过“设置额度”配置每日积分上限或 unlimited；不再向子账号个人钱包转入积分。',
              }) })()
            : reclaimAccountPoints(operatorId, target.id, points, { operatorId, idempotencyKey, note })
        })()

    if (!result) {
      return forbidden(operation === 'recharge'
        ? '只有平台 Admin 可以给自己创建的管理账号充值积分。'
        : '管理账号只能向自己的直属子账号分配或收回积分。')
    }

    const settled = await result
    const refreshedTarget = await prisma.user.findUniqueOrThrow({
      where: { id: target.id },
      select: managedAccountSelect,
    })
    logInfo('[AccountCredits] 积分操作完成', {
      operatorUserId: operatorId,
      targetUserId: target.id,
      operation,
      points,
      amountCny: settled.amountCny,
      idempotent: settled.idempotent,
    })
    const response = NextResponse.json({
      success: true,
      result: settled,
      account: serializeManagedAccount(refreshedTarget),
    })
    response.headers.set('x-idempotent-replay', settled.idempotent ? 'true' : 'false')
    return response
  } catch (error) {
    if (error instanceof CreditLedgerError) {
      if (error.code === 'INSUFFICIENT_POINTS') {
        throw new ApiError('INSUFFICIENT_BALANCE', { message: error.message, required: points })
      }
      throw new ApiError('INVALID_PARAMS', { message: error.message })
    }
    throw error
  }
})
