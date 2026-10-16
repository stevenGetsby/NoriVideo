import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  user: {
    findMany: vi.fn(async (): Promise<Array<{ id: string; dailyPointLimit: number | null }>> => []),
  },
  balanceTransaction: {
    groupBy: vi.fn(async (): Promise<Array<{ userId: string; _sum: { amount: unknown } }>> => []),
  },
  balanceFreeze: {
    findUnique: vi.fn(async (): Promise<{ id: string; userId: string; status: string } | null> => null),
    create: vi.fn(async () => ({})),
    groupBy: vi.fn(async (): Promise<Array<{ userId: string; _sum: { amount: unknown } }>> => []),
  },
  userBalance: {
    findUnique: vi.fn(async () => null),
    create: vi.fn(async () => ({})),
    updateMany: vi.fn(async () => ({ count: 1 })),
    upsert: vi.fn(async () => ({})),
  },
  $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(prismaMock)),
  $queryRaw: vi.fn(async () => []),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

import { freezeBalance } from '@/lib/billing/ledger'
import { DailyLimitExceededError } from '@/lib/billing/errors'

describe('billing/daily-limit 冻结闸门', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.user.findMany.mockResolvedValue([])
    prismaMock.balanceTransaction.groupBy.mockResolvedValue([])
    prismaMock.balanceFreeze.groupBy.mockResolvedValue([])
    prismaMock.balanceFreeze.findUnique.mockResolvedValue(null)
    prismaMock.userBalance.updateMany.mockResolvedValue({ count: 1 })
    prismaMock.$transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback(prismaMock))
  })

  it('余额充足但今日额度用尽时拒绝冻结，且不写任何冻结记录', async () => {
    prismaMock.user.findMany.mockResolvedValue([{ id: 'u1', dailyPointLimit: 500 }])
    prismaMock.balanceTransaction.groupBy.mockResolvedValue([{ userId: 'u1', _sum: { amount: -5 } }])

    await expect(freezeBalance('u1', 1, { source: 'task', idempotencyKey: 'key-1' }))
      .rejects.toBeInstanceOf(DailyLimitExceededError)
    expect(prismaMock.balanceFreeze.create).not.toHaveBeenCalled()
    expect(prismaMock.userBalance.updateMany).not.toHaveBeenCalled()
  })

  it('本次报价会把当日额度顶超时同样拒绝', async () => {
    prismaMock.user.findMany.mockResolvedValue([{ id: 'u1', dailyPointLimit: 1000 }])
    prismaMock.balanceTransaction.groupBy.mockResolvedValue([{ userId: 'u1', _sum: { amount: -9.5 } }])

    // 已用 950 积分，本次 ¥1 = 100 积分，超出 1000
    await expect(freezeBalance('u1', 1, { source: 'task' })).rejects.toBeInstanceOf(DailyLimitExceededError)
    // 只要 ¥0.5 = 50 积分，刚好用满仍可冻结
    await expect(freezeBalance('u1', 0.5, { source: 'task' })).resolves.toEqual(expect.any(String))
  })

  it('未设置上限时不拦截冻结', async () => {
    await expect(freezeBalance('u1', 1, { source: 'task' })).resolves.toEqual(expect.any(String))
    expect(prismaMock.balanceFreeze.create).toHaveBeenCalled()
  })
  it('上限 0 无需已有消耗就拒绝冻结，并且不动余额', async () => {
    prismaMock.user.findMany.mockResolvedValue([{ id: 'u1', dailyPointLimit: 0 }])
    await expect(freezeBalance('u1', 1, { source: 'task' })).rejects.toMatchObject({ limitPoints: 0 })
    expect(prismaMock.balanceFreeze.create).not.toHaveBeenCalled()
    expect(prismaMock.userBalance.updateMany).not.toHaveBeenCalled()
  })
  it('rechecks a limit changed during preflight before debiting any funds', async () => {
    prismaMock.user.findMany.mockResolvedValueOnce([{ id: 'u1', dailyPointLimit: 500 }])
      .mockResolvedValue([{ id: 'u1', dailyPointLimit: 0 }])
    await expect(freezeBalance('u1', 1)).rejects.toMatchObject({ limitPoints: 0 })
    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(1)
    expect(prismaMock.balanceFreeze.create).not.toHaveBeenCalled()
    expect(prismaMock.userBalance.updateMany).not.toHaveBeenCalled()
  })

  it('幂等重放直接复用原冻结，不再消耗当日额度', async () => {
    prismaMock.user.findMany.mockResolvedValue([{ id: 'u1', dailyPointLimit: 10 }])
    prismaMock.balanceTransaction.groupBy.mockResolvedValue([{ userId: 'u1', _sum: { amount: -1 } }])
    prismaMock.balanceFreeze.findUnique.mockResolvedValue({ id: 'freeze_existing', userId: 'u1', status: 'pending' })

    await expect(freezeBalance('u1', 5, { idempotencyKey: 'replay-key' })).resolves.toBe('freeze_existing')
    expect(prismaMock.balanceFreeze.create).not.toHaveBeenCalled()
  })
  it('never reuses another wallet freeze, or allows a second sync execution claim', async () => {
    prismaMock.balanceFreeze.findUnique.mockResolvedValue({ id: 'existing', userId: 'foreign', status: 'pending' })
    await expect(freezeBalance('u1', 1, { idempotencyKey: 'same' })).rejects.toMatchObject({ code: 'BILLING_INVALID_FREEZE' })
    prismaMock.balanceFreeze.findUnique.mockResolvedValue({ id: 'existing', userId: 'u1', status: 'pending' })
    await expect(freezeBalance('u1', 1, { idempotencyKey: 'same', rejectExisting: true }))
      .rejects.toMatchObject({ code: 'BILLING_IDEMPOTENT_IN_PROGRESS' })
    expect(prismaMock.userBalance.updateMany).not.toHaveBeenCalled()
  })
  it('does not report a database failure as insufficient points', async () => {
    const failure = Object.assign(new Error('transaction pool timeout'), { code: 'P2028' })
    prismaMock.$transaction.mockRejectedValueOnce(failure)
    await expect(freezeBalance('u1', 1)).rejects.toBe(failure)
    expect(prismaMock.balanceFreeze.create).not.toHaveBeenCalled()
  })
})
