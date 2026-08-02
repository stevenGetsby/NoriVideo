import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { cnyToPoints, pointsToCny } from './credit-policy'
import { toMoneyNumber } from './money'

export type CreditOperation = 'recharge' | 'allocate' | 'reclaim'

export class CreditLedgerError extends Error {
  constructor(
    public readonly code: 'INVALID_POINTS' | 'INSUFFICIENT_POINTS' | 'ACCOUNT_NOT_FOUND' | 'IDEMPOTENCY_CONFLICT',
    message: string,
  ) {
    super(message)
    this.name = 'CreditLedgerError'
  }
}

type CreditMutationOptions = {
  operatorId: string
  idempotencyKey: string
  note?: string | null
}

type BalanceResult = {
  userId: string
  balanceCny: number
  balancePoints: number
}

export type CreditMutationResult = {
  operation: CreditOperation
  points: number
  amountCny: number
  source: BalanceResult | null
  target: BalanceResult
  idempotent: boolean
}

function readPositiveIntegerPoints(points: number) {
  if (!Number.isSafeInteger(points) || points <= 0) {
    throw new CreditLedgerError('INVALID_POINTS', '积分必须是大于 0 的整数。')
  }
  return points
}

function snapshot(userId: string, balance: Prisma.Decimal | number): BalanceResult {
  const balanceCny = toMoneyNumber(balance)
  return { userId, balanceCny, balancePoints: cnyToPoints(balanceCny) }
}

function auditDescription(input: {
  operation: CreditOperation
  points: number
  amountCny: number
  operatorId: string
  counterpartId?: string | null
  note?: string | null
}) {
  return JSON.stringify({
    operation: input.operation,
    points: input.points,
    amountCny: input.amountCny,
    operatorId: input.operatorId,
    counterpartId: input.counterpartId || null,
    note: input.note?.trim() || null,
    pointsPerCny: 100,
  })
}

async function readBalanceInTransaction(tx: Prisma.TransactionClient, userId: string) {
  return await tx.userBalance.upsert({
    where: { userId },
    create: { userId, balance: 0, frozenAmount: 0, totalSpent: 0 },
    update: {},
  })
}

function prismaErrorCode(error: unknown): string {
  return error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
    ? error.code
    : ''
}

function assertIdempotentAmount(stored: Prisma.Decimal | number, expectedCny: number) {
  if (Math.abs(Math.abs(toMoneyNumber(stored)) - expectedCny) > 0.000001) {
    throw new CreditLedgerError(
      'IDEMPOTENCY_CONFLICT',
      '同一积分请求编号不能用于不同的积分数量。请关闭弹窗后重新操作。',
    )
  }
}

async function readCurrentBalance(userId: string) {
  return await prisma.userBalance.upsert({
    where: { userId },
    create: { userId, balance: 0, frozenAmount: 0, totalSpent: 0 },
    update: {},
  })
}

export async function rechargeAccountPoints(
  targetUserId: string,
  pointsInput: number,
  options: CreditMutationOptions,
): Promise<CreditMutationResult> {
  const points = readPositiveIntegerPoints(pointsInput)
  const amountCny = pointsToCny(points)

  const replay = async (): Promise<CreditMutationResult | null> => {
    const existing = await prisma.balanceTransaction.findFirst({
      where: { userId: targetUserId, type: 'recharge', idempotencyKey: options.idempotencyKey },
      select: { amount: true },
    })
    if (!existing) return null
    assertIdempotentAmount(existing.amount, amountCny)
    const current = await readCurrentBalance(targetUserId)
    return {
      operation: 'recharge',
      points,
      amountCny,
      source: null,
      target: snapshot(targetUserId, current.balance),
      idempotent: true,
    }
  }

  const execute = async (attempt: number): Promise<CreditMutationResult> => {
    try {
      return await prisma.$transaction(async (tx) => {
        const existing = await tx.balanceTransaction.findFirst({
          where: { userId: targetUserId, type: 'recharge', idempotencyKey: options.idempotencyKey },
          select: { amount: true },
        })
        if (existing) {
          assertIdempotentAmount(existing.amount, amountCny)
          const current = await readBalanceInTransaction(tx, targetUserId)
          return {
            operation: 'recharge' as const,
            points,
            amountCny,
            source: null,
            target: snapshot(targetUserId, current.balance),
            idempotent: true,
          }
        }

        const target = await tx.userBalance.upsert({
          where: { userId: targetUserId },
          create: { userId: targetUserId, balance: amountCny, frozenAmount: 0, totalSpent: 0 },
          update: { balance: { increment: amountCny } },
        })
        await tx.balanceTransaction.create({
          data: {
            userId: targetUserId,
            type: 'recharge',
            amount: amountCny,
            balanceAfter: target.balance,
            description: auditDescription({
              operation: 'recharge',
              points,
              amountCny,
              operatorId: options.operatorId,
              note: options.note,
            }),
            operatorId: options.operatorId,
            idempotencyKey: options.idempotencyKey,
          },
        })

        return {
          operation: 'recharge' as const,
          points,
          amountCny,
          source: null,
          target: snapshot(targetUserId, target.balance),
          idempotent: false,
        }
      }, { maxWait: 10_000, timeout: 10_000, isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
    } catch (error) {
      const code = prismaErrorCode(error)
      if (code === 'P2034' && attempt < 2) return await execute(attempt + 1)
      if (code === 'P2002' || code === 'P2034') {
        const existing = await replay()
        if (existing) return existing
      }
      throw error
    }
  }

  return await execute(0)
}

async function transferPoints(input: {
  operation: 'allocate' | 'reclaim'
  sourceUserId: string
  targetUserId: string
  pointsInput: number
  options: CreditMutationOptions
}): Promise<CreditMutationResult> {
  const points = readPositiveIntegerPoints(input.pointsInput)
  const amountCny = pointsToCny(points)
  const sourceType = input.operation === 'allocate' ? 'allocate_out' : 'reclaim_out'
  const targetType = input.operation === 'allocate' ? 'allocate_in' : 'reclaim_in'

  const replay = async (): Promise<CreditMutationResult | null> => {
    const existing = await prisma.balanceTransaction.findFirst({
      where: {
        userId: input.sourceUserId,
        type: sourceType,
        idempotencyKey: input.options.idempotencyKey,
      },
      select: { amount: true },
    })
    if (!existing) return null
    assertIdempotentAmount(existing.amount, amountCny)
    const [source, target] = await Promise.all([
      readCurrentBalance(input.sourceUserId),
      readCurrentBalance(input.targetUserId),
    ])
    return {
      operation: input.operation,
      points,
      amountCny,
      source: snapshot(input.sourceUserId, source.balance),
      target: snapshot(input.targetUserId, target.balance),
      idempotent: true,
    }
  }

  const execute = async (attempt: number): Promise<CreditMutationResult> => {
    try {
      return await prisma.$transaction(async (tx) => {
    const existing = await tx.balanceTransaction.findFirst({
      where: {
        userId: input.sourceUserId,
        type: sourceType,
        idempotencyKey: input.options.idempotencyKey,
      },
      select: { amount: true },
    })
    if (existing) {
      assertIdempotentAmount(existing.amount, amountCny)
      const [source, target] = await Promise.all([
        readBalanceInTransaction(tx, input.sourceUserId),
        readBalanceInTransaction(tx, input.targetUserId),
      ])
      return {
        operation: input.operation,
        points,
        amountCny,
        source: snapshot(input.sourceUserId, source.balance),
        target: snapshot(input.targetUserId, target.balance),
        idempotent: true,
      }
    }

    await readBalanceInTransaction(tx, input.sourceUserId)
    const debited = await tx.userBalance.updateMany({
      where: { userId: input.sourceUserId, balance: { gte: amountCny } },
      data: { balance: { decrement: amountCny } },
    })
    if (debited.count !== 1) {
      throw new CreditLedgerError('INSUFFICIENT_POINTS', '可用积分不足，无法完成此次操作。')
    }

    const [source, target] = await Promise.all([
      tx.userBalance.findUniqueOrThrow({ where: { userId: input.sourceUserId } }),
      tx.userBalance.upsert({
        where: { userId: input.targetUserId },
        create: { userId: input.targetUserId, balance: amountCny, frozenAmount: 0, totalSpent: 0 },
        update: { balance: { increment: amountCny } },
      }),
    ])
    const description = auditDescription({
      operation: input.operation,
      points,
      amountCny,
      operatorId: input.options.operatorId,
      counterpartId: input.targetUserId,
      note: input.options.note,
    })
    await tx.balanceTransaction.createMany({
      data: [
        {
          userId: input.sourceUserId,
          type: sourceType,
          amount: -amountCny,
          balanceAfter: source.balance,
          description,
          relatedId: input.targetUserId,
          operatorId: input.options.operatorId,
          idempotencyKey: input.options.idempotencyKey,
        },
        {
          userId: input.targetUserId,
          type: targetType,
          amount: amountCny,
          balanceAfter: target.balance,
          description: auditDescription({
            operation: input.operation,
            points,
            amountCny,
            operatorId: input.options.operatorId,
            counterpartId: input.sourceUserId,
            note: input.options.note,
          }),
          relatedId: input.sourceUserId,
          operatorId: input.options.operatorId,
          idempotencyKey: input.options.idempotencyKey,
        },
      ],
    })

    return {
      operation: input.operation,
      points,
      amountCny,
      source: snapshot(input.sourceUserId, source.balance),
      target: snapshot(input.targetUserId, target.balance),
      idempotent: false,
    }
      }, { maxWait: 10_000, timeout: 10_000, isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
    } catch (error) {
      const code = prismaErrorCode(error)
      if (code === 'P2034' && attempt < 2) return await execute(attempt + 1)
      if (code === 'P2002' || code === 'P2034') {
        const existing = await replay()
        if (existing) return existing
      }
      throw error
    }
  }

  return await execute(0)
}

export async function allocateAccountPoints(
  managerUserId: string,
  subaccountUserId: string,
  points: number,
  options: CreditMutationOptions,
) {
  return await transferPoints({
    operation: 'allocate',
    sourceUserId: managerUserId,
    targetUserId: subaccountUserId,
    pointsInput: points,
    options,
  })
}

export async function reclaimAccountPoints(
  managerUserId: string,
  subaccountUserId: string,
  points: number,
  options: CreditMutationOptions,
) {
  return await transferPoints({
    operation: 'reclaim',
    sourceUserId: subaccountUserId,
    targetUserId: managerUserId,
    pointsInput: points,
    options,
  })
}
