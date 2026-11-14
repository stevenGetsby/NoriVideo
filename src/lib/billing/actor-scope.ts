import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

export type RecordScope =
  | { kind: 'team'; ownerId: string; accountIds: string[] }
  | { kind: 'self'; ownerId: string; actorId: string }

export async function resolveRecordScope(user: { id: string; actorId?: string | null }): Promise<RecordScope> {
  const ownerId = user.id
  const actorId = user.actorId ?? user.id
  if (actorId === ownerId) {
    const accounts = await prisma.user.findMany({
      where: { OR: [{ id: ownerId }, { workspaceOwnerId: ownerId }] },
      select: { id: true },
    })
    return { kind: 'team', ownerId, accountIds: Array.from(new Set([ownerId, ...accounts.map((account) => account.id)])) }
  }
  return { kind: 'self', ownerId, actorId }
}

export function usageCostWhere(scope: RecordScope): Prisma.UsageCostWhereInput {
  if (scope.kind === 'team') return { userId: { in: scope.accountIds } }
  return {
    OR: [
      { userId: scope.actorId },
      { userId: scope.ownerId, metadata: { contains: `"quotaUserId":"${scope.actorId}"` } },
    ],
  }
}

export function transactionWhere(scope: RecordScope): Prisma.BalanceTransactionWhereInput {
  if (scope.kind === 'team') return { userId: scope.ownerId }
  return {
    OR: [
      { userId: scope.actorId },
      { userId: scope.ownerId, type: 'consume', billingMeta: { contains: `"quotaUserId":"${scope.actorId}"` } },
      { userId: scope.ownerId, type: { in: ['allocate_out', 'allocate_in'] }, description: { contains: `"counterpartId":"${scope.actorId}"` } },
    ],
  }
}

export function taskWhere(scope: RecordScope): Prisma.TaskWhereInput {
  if (scope.kind === 'team') return { userId: scope.ownerId }
  return { userId: scope.ownerId, payload: { path: '$.meta.quotaUserId', equals: scope.actorId } }
}

export function isManagerPaid(row: { userId: string; type?: string }, scope: RecordScope): boolean {
  return scope.kind === 'self' && row.userId === scope.ownerId && (!row.type || row.type === 'consume')
}
