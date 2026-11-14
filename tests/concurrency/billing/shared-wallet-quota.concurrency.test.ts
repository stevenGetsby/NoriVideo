import { beforeEach, describe, expect, it } from 'vitest'
import { setAccountActorContext, withAccountPermissionContext } from '@/lib/account/request-context'
import { getDailyUsageSnapshot } from '@/lib/billing/daily-limit'
import { DailyLimitExceededError } from '@/lib/billing/errors'
import { allocateAccountPoints, reclaimAccountPoints } from '@/lib/billing/credit-ledger'
import { confirmChargeWithRecord, freezeBalance, getBalance, rollbackFreeze } from '@/lib/billing/ledger'
import { prisma } from '../../helpers/prisma'
import { resetBillingState } from '../../helpers/db-reset'
import { createTestProject, createTestUser, seedBalance } from '../../helpers/billing-fixtures'

async function sharedAccounts(limit: number | null, pointMode: 'unlimited' | 'allocated' = 'unlimited') {
  const owner = await createTestUser()
  const child = await createTestUser()
  await prisma.user.update({ where: { id: owner.id }, data: { role: 'admin', dailyPointLimit: 0 } })
  await prisma.user.update({
    where: { id: child.id },
    data: { role: 'storyboard', workspaceOwnerId: owner.id, parentAccountId: owner.id, dailyPointLimit: limit, pointMode },
  })
  await seedBalance(owner.id, 10)
  await seedBalance(child.id, 0)
  return { owner, child }
}

function asChild<T>(ownerId: string, childId: string, run: () => T) {
  return withAccountPermissionContext([], () => {
    setAccountActorContext(childId, ownerId)
    return run()
  })
}

async function teamTotal(userIds: string[]) {
  const balances = await prisma.userBalance.findMany({
    where: { userId: { in: userIds } },
    select: { balance: true, frozenAmount: true },
  })
  return balances.reduce(
    (sum, row) => sum + Number(row.balance) + Number(row.frozenAmount),
    0,
  )
}

describe('shared wallet / personal daily quota concurrency', () => {
  beforeEach(async () => {
    await resetBillingState()
    process.env.BILLING_MODE = 'ENFORCE'
  })

  it('serializes concurrent reservations against the child cap, not the owner cap', async () => {
    const { owner, child } = await sharedAccounts(100)
    const results = await Promise.allSettled([0, 1].map((attempt) =>
      asChild(owner.id, child.id, () => freezeBalance(child.id, 0.6, { idempotencyKey: `child-cap-${attempt}` }))))
    const fulfilled = results.filter((result) => result.status === 'fulfilled')
    const rejected = results.filter((result) => result.status === 'rejected')
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(DailyLimitExceededError)
    // The member wallet owns the reservation; the manager only lost the
    // auto-funded shortfall and has no frozen amount of its own.
    expect(await getBalance(child.id)).toMatchObject({ balance: 0, frozenAmount: 0.6 })
    expect(await getBalance(owner.id)).toMatchObject({ balance: 9.4, frozenAmount: 0 })
    expect(await getDailyUsageSnapshot(child.id)).toMatchObject({ usedPoints: 60, remainingPoints: 40 })
    expect(await getDailyUsageSnapshot(owner.id)).toMatchObject({ usedPoints: 0 })
    expect(await prisma.balanceFreeze.count()).toBe(1)
  })

  it('allows an unlimited zero-balance child to use the shared wallet and attributes settlement correctly', async () => {
    const { owner, child } = await sharedAccounts(null)
    const project = await createTestProject(owner.id)
    const freezeId = await asChild(owner.id, child.id, () => freezeBalance(child.id, 1))
    expect(freezeId).toEqual(expect.any(String))
    expect(await confirmChargeWithRecord(freezeId!, {
      projectId: project.id, action: 'shared-wallet-regression', apiType: 'video',
      model: 'nori::norivideo2.5', quantity: 5, unit: 'second',
    }, { chargedAmount: 0.8 })).toBe(true)
    expect(await getBalance(owner.id)).toMatchObject({ balance: 9, frozenAmount: 0, totalSpent: 0 })
    expect(await getBalance(child.id)).toMatchObject({ balance: 0.2, frozenAmount: 0, totalSpent: 0.8 })
    expect(await getDailyUsageSnapshot(child.id)).toMatchObject({ limitPoints: null, consumedPoints: 80, pendingPoints: 0 })
    expect(await getDailyUsageSnapshot(owner.id)).toMatchObject({ usedPoints: 0 })
    expect(await prisma.balanceTransaction.count({
      where: { freezeId, type: 'auto_allocate_in', userId: child.id },
    })).toBe(1)
  })

  it('still rejects zero personal caps and empty shared wallets without consuming money', async () => {
    const { owner, child } = await sharedAccounts(0)
    await expect(asChild(owner.id, child.id, () => freezeBalance(child.id, 1)))
      .rejects.toMatchObject({ limitPoints: 0 })
    await prisma.user.update({ where: { id: child.id }, data: { dailyPointLimit: null } })
    await seedBalance(owner.id, 0)
    expect(await asChild(owner.id, child.id, () => freezeBalance(child.id, 1))).toBeNull()
    expect(await prisma.balanceFreeze.count()).toBe(0)
    expect(await getBalance(owner.id)).toMatchObject({ balance: 0, frozenAmount: 0 })
    expect(await getBalance(child.id)).toMatchObject({ balance: 0, frozenAmount: 0 })
    expect(await prisma.balanceTransaction.count({ where: { type: { startsWith: 'auto_allocate' } } })).toBe(0)
  })

  it('does not auto-fund an allocated member even when the manager can cover the quote', async () => {
    const { owner, child } = await sharedAccounts(null, 'allocated')
    expect(await asChild(owner.id, child.id, () => freezeBalance(child.id, 1))).toBeNull()
    expect(await getBalance(owner.id)).toMatchObject({ balance: 10, frozenAmount: 0 })
    expect(await getBalance(child.id)).toMatchObject({ balance: 0, frozenAmount: 0 })
    expect(await prisma.balanceFreeze.count()).toBe(0)
    expect(await prisma.balanceTransaction.count({ where: { type: { startsWith: 'auto_allocate' } } })).toBe(0)
  })

  it('returns pending personal quota on failure so another request can use it', async () => {
    const { owner, child } = await sharedAccounts(100)
    const first = await asChild(owner.id, child.id, () => freezeBalance(child.id, 1))
    expect(await getDailyUsageSnapshot(child.id)).toMatchObject({ usedPoints: 100, exceeded: true })
    expect(await rollbackFreeze(first!)).toBe(true)
    expect(await getDailyUsageSnapshot(child.id)).toMatchObject({ usedPoints: 0, exceeded: false })
    // The first reservation auto-funded 1 CNY from the manager; after rollback
    // the refunded amount stays in the member wallet and the retry reserves it
    // directly without a second top-up.
    expect(await getBalance(owner.id)).toMatchObject({ balance: 9, frozenAmount: 0 })
    const retry = await asChild(owner.id, child.id, () => freezeBalance(child.id, 1))
    expect(retry).toEqual(expect.any(String))
    expect(await getBalance(child.id)).toMatchObject({ balance: 0, frozenAmount: 1 })
    expect(await getBalance(owner.id)).toMatchObject({ balance: 9, frozenAmount: 0 })
  })
  it('lets only one of two unlimited members top up when the manager can fund one quote', async () => {
    const { owner, child } = await sharedAccounts(null)
    await seedBalance(owner.id, 1)
    const childB = await createTestUser()
    await prisma.user.update({
      where: { id: childB.id },
      data: {
        role: 'storyboard',
        workspaceOwnerId: owner.id,
        parentAccountId: owner.id,
        dailyPointLimit: null,
        pointMode: 'unlimited',
      },
    })
    await seedBalance(childB.id, 0)
    const userIds = [owner.id, child.id, childB.id]
    const before = await teamTotal(userIds)

    const results = await Promise.allSettled([
      asChild(owner.id, child.id, () => freezeBalance(child.id, 1, { idempotencyKey: 'two-members-a' })),
      asChild(owner.id, childB.id, () => freezeBalance(childB.id, 1, { idempotencyKey: 'two-members-b' })),
    ])
    expect(results.every((result) => result.status === 'fulfilled')).toBe(true)
    const fulfilled = results.filter((result) =>
      result.status === 'fulfilled' && result.value !== null)
    expect(fulfilled).toHaveLength(1)
    expect(await prisma.balanceFreeze.count()).toBe(1)
    expect(await getBalance(owner.id)).toMatchObject({ balance: 0, frozenAmount: 0 })
    expect(await prisma.balanceTransaction.count({ where: { type: 'auto_allocate_in' } })).toBe(1)
    expect(await teamTotal(userIds)).toBeCloseTo(before, 8)
  })

  it('does not deadlock when the manager allocates points while the member auto-funds', async () => {
    const { owner, child } = await sharedAccounts(null)
    const userIds = [owner.id, child.id]
    const before = await teamTotal(userIds)

    const results = await Promise.allSettled([
      asChild(owner.id, child.id, () => freezeBalance(child.id, 5, { idempotencyKey: 'allocate-race' })),
      allocateAccountPoints(owner.id, child.id, 3, { operatorId: owner.id, idempotencyKey: 'allocate-race-grant' }),
    ])
    expect(results.every((result) => result.status === 'fulfilled')).toBe(true)
    expect(await prisma.balanceFreeze.count()).toBe(1)
    expect(await getBalance(child.id)).toMatchObject({ frozenAmount: 5 })
    expect(await getBalance(owner.id)).toMatchObject({ frozenAmount: 0 })
    expect(await teamTotal(userIds)).toBeCloseTo(before, 8)
  })

  it('does not deadlock when the manager generates while the member auto-funds', async () => {
    const { owner, child } = await sharedAccounts(null)
    await prisma.user.update({ where: { id: owner.id }, data: { dailyPointLimit: null } })
    await seedBalance(owner.id, 7)
    const userIds = [owner.id, child.id]
    const before = await teamTotal(userIds)

    const results = await Promise.allSettled([
      asChild(owner.id, child.id, () => freezeBalance(child.id, 5, { idempotencyKey: 'manager-generation-race' })),
      freezeBalance(owner.id, 5, { idempotencyKey: 'manager-generation-own' }),
    ])
    expect(results.every((result) => result.status === 'fulfilled')).toBe(true)
    const fulfilled = results.filter((result) =>
      result.status === 'fulfilled' && result.value !== null)
    expect(fulfilled).toHaveLength(1)
    expect(await prisma.balanceFreeze.count()).toBe(1)
    expect((await getBalance(owner.id)).balance).toBeGreaterThanOrEqual(0)
    expect(await teamTotal(userIds)).toBeCloseTo(before, 8)
  })

  it('reclaims fractional legacy balances exactly once and leaves the child quota unchanged', async () => {
    const { owner, child } = await sharedAccounts(null)
    await seedBalance(child.id, 0.006789)
    const options = { operatorId: owner.id, idempotencyKey: 'fractional-reclaim' }
    await reclaimAccountPoints(owner.id, child.id, 0.6789, options)
    await reclaimAccountPoints(owner.id, child.id, 0.6789, options)
    expect((await getBalance(child.id)).balance).toBe(0)
    expect((await getBalance(owner.id)).balance).toBeCloseTo(10.006789, 6)
    expect(await getDailyUsageSnapshot(child.id)).toMatchObject({ limitPoints: null, usedPoints: 0 })
    expect(await prisma.balanceTransaction.count({ where: { idempotencyKey: options.idempotencyKey } })).toBe(2)
    await expect(reclaimAccountPoints(owner.id, child.id, 0.6788, options)).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' })
  })
})
