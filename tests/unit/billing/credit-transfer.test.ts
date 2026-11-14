import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  balances: new Map<string, number>(),
  keys: new Set<string>(),
  writes: 0,
  locks: [] as string[],
}))
const txMock = vi.hoisted(() => ({
  $queryRaw: vi.fn(async (query: { values: string[]; strings: string[] }) => {
    state.locks.push(query.values.join(','))
    expect(query.strings.join(' ')).toContain('FOR UPDATE')
    expect(query.values).toEqual([...query.values].sort())
    return []
  }),
  userBalance: {
    upsert: vi.fn(async ({ where, create, update }: { where: { userId: string }; create: { balance: number }; update: { balance?: { increment: number } } }) => {
      const balance = (state.balances.get(where.userId) ?? create.balance) + (update.balance?.increment || 0)
      state.balances.set(where.userId, balance)
      return { balance }
    }),
    updateMany: vi.fn(async ({ where, data }: { where: { userId: string; balance: { gte: number } }; data: { balance: { decrement: number } } }) => {
      const balance = state.balances.get(where.userId) || 0
      if (balance < where.balance.gte) return { count: 0 }
      state.balances.set(where.userId, balance - data.balance.decrement)
      return { count: 1 }
    }),
    findUniqueOrThrow: vi.fn(async ({ where }: { where: { userId: string } }) => ({ balance: state.balances.get(where.userId) || 0 })),
  },
  balanceTransaction: {
    findMany: vi.fn(async ({ where }: { where: { idempotencyKey: { in: string[] } } }) => where.idempotencyKey.in.filter((key) => state.keys.has(key)).map((key) => ({ relatedId: key.split(':').pop(), amount: 0.1 }))),
    findFirst: vi.fn(async ({ where }: { where: { idempotencyKey: string } }) => state.keys.has(where.idempotencyKey) ? { amount: 0.1 } : null),
    createMany: vi.fn(async ({ data }: { data: Array<{ idempotencyKey: string }> }) => {
      state.writes += data.length
      for (const row of data) state.keys.add(row.idempotencyKey)
    }),
  },
}))
const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(async (callback: (tx: typeof txMock) => Promise<unknown>) => {
    const balances = new Map(state.balances)
    const keys = new Set(state.keys)
    const writes = state.writes
    try { return await callback(txMock) } catch (error) {
      state.balances = balances; state.keys = keys; state.writes = writes
      throw error
    }
  }),
  balanceTransaction: txMock.balanceTransaction,
  userBalance: txMock.userBalance,
}))
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
import { allocateAccountPoints, allocateAccountPointsBulk, reclaimAccountPoints } from '@/lib/billing/credit-ledger'

describe('atomic account transfers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.balances = new Map([['manager', 1], ['member-a', 0], ['member-b', 0]])
    state.keys = new Set()
    state.writes = 0
    state.locks = []
  })
  it('locks both accounts in deterministic order before allocation and reclaim', async () => {
    await allocateAccountPoints('manager', 'member-a', 10, { operatorId: 'manager', idempotencyKey: 'one' })
    await reclaimAccountPoints('manager', 'member-a', 1, { operatorId: 'manager', idempotencyKey: 'two' })
    expect(state.locks).toEqual(['manager,member-a', 'manager,member-a'])
    expect(state.balances.get('manager')).toBe(0.91)
    expect(state.balances.get('member-a')).toBeCloseTo(0.09)
  })
  it('allocates to multiple members in one transaction and deduplicates targets', async () => {
    const result = await allocateAccountPointsBulk({ operatorId: 'manager', targetUserIds: ['member-a', 'member-a', 'member-b'], points: 10, idempotencyKey: 'bulk' })
    expect(result.allocated).toHaveLength(2)
    expect(result.operatorBalancePoints).toBe(80)
    expect(state.writes).toBe(4)
    expect(state.locks[0]).toBe('manager,member-a,member-b')
  })
  it('replays each target without charging it twice', async () => {
    const input = { operatorId: 'manager', targetUserIds: ['member-a', 'member-b'], points: 10, idempotencyKey: 'bulk' }
    await allocateAccountPointsBulk(input)
    const replay = await allocateAccountPointsBulk(input)
    expect(replay.allocated.every((row) => row.idempotent)).toBe(true)
    expect(replay.operatorBalancePoints).toBe(80)
    expect(state.writes).toBe(4)
  })
  it('rolls back the whole batch when the manager balance is insufficient', async () => {
    await expect(allocateAccountPointsBulk({ operatorId: 'manager', targetUserIds: ['member-a', 'member-b'], points: 100, idempotencyKey: 'poor' })).rejects.toMatchObject({ code: 'INSUFFICIENT_POINTS' })
    expect(state.balances.get('manager')).toBe(1)
    expect(state.writes).toBe(0)
  })
})
