import { beforeEach, describe, expect, it, vi } from 'vitest'
import { withAccountPermissionContext, setAccountActorContext } from '@/lib/account/request-context'

const prismaMock = vi.hoisted(() => ({
  user: { findMany: vi.fn(async () => []) },
  balanceTransaction: { groupBy: vi.fn(async () => []), findMany: vi.fn(async () => []) },
  balanceFreeze: { groupBy: vi.fn(async () => []), findMany: vi.fn(async () => []), findUnique: vi.fn(), create: vi.fn() },
  userBalance: { findUnique: vi.fn(async () => ({ balance: 100 })), updateMany: vi.fn(async () => ({ count: 1 })) },
  $transaction: vi.fn(),
  $queryRaw: vi.fn(async () => []),
}))
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
import { freezeBalance, confirmChargeWithRecord } from '@/lib/billing/ledger'

describe('generation quota principal attribution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.balanceFreeze.findUnique.mockResolvedValue(null)
    prismaMock.$transaction.mockImplementation(async (run: (tx: unknown) => unknown) => run(prismaMock))
  })
  it('tags a shared-wallet reservation with the trusted actor rather than caller-supplied metadata', async () => {
    await withAccountPermissionContext([], async () => {
      setAccountActorContext('child', 'manager')
      await freezeBalance('manager', 1, { metadata: { quotaUserId: 'forged', model: 'video' } })
    })
    const record = prismaMock.balanceFreeze.create.mock.calls[0][0].data
    expect(record.userId).toBe('manager')
    expect(JSON.parse(record.metadata)).toEqual({ quotaUserId: 'child', model: 'video' })
  })
  it('preserves operator attribution when a background worker settles the freeze', async () => {
    const tx = {
      balanceFreeze: {
        findUnique: vi.fn(async () => ({ id: 'f1', userId: 'manager', status: 'pending', amount: 1, metadata: '{"quotaUserId":"child"}' })),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      userBalance: { update: vi.fn(async () => ({ balance: 99 })) },
      project: { findUnique: vi.fn(async () => ({ id: 'p1' })) },
      usageCost: { create: vi.fn() },
      balanceTransaction: { create: vi.fn() },
    }
    prismaMock.$transaction.mockImplementation(async (run: (tx: unknown) => unknown) => run(tx))
    await confirmChargeWithRecord('f1', {
      projectId: 'p1', action: 'video', apiType: 'video', model: 'test-video', quantity: 5, unit: 'second',
    })
    const row = tx.balanceTransaction.create.mock.calls[0][0].data
    expect(row.userId).toBe('manager')
    expect(row.amount).toBe(-1)
    expect(JSON.parse(row.billingMeta).quotaUserId).toBe('child')
  })
})
