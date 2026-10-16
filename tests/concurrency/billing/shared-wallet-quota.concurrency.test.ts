import { beforeEach, describe, expect, it } from 'vitest'
import { setAccountActorContext, withAccountPermissionContext } from '@/lib/account/request-context'
import { getDailyUsageSnapshot } from '@/lib/billing/daily-limit'
import { DailyLimitExceededError } from '@/lib/billing/errors'
import { reclaimAccountPoints } from '@/lib/billing/credit-ledger'
import { confirmChargeWithRecord, freezeBalance, getBalance, rollbackFreeze } from '@/lib/billing/ledger'
import { prisma } from '../../helpers/prisma'
import { resetBillingState } from '../../helpers/db-reset'
import { createTestProject, createTestUser, seedBalance } from '../../helpers/billing-fixtures'

async function sharedAccounts(limit: number | null) {
  const owner = await createTestUser()
  const child = await createTestUser()
  await prisma.user.update({ where: { id: owner.id }, data: { role: 'admin', dailyPointLimit: 0 } })
  await prisma.user.update({
    where: { id: child.id },
    data: { role: 'storyboard', workspaceOwnerId: owner.id, parentAccountId: owner.id, dailyPointLimit: limit },
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

describe('shared wallet / personal daily quota concurrency', () => {
  beforeEach(async () => {
    await resetBillingState()
    process.env.BILLING_MODE = 'ENFORCE'
  })

  it('serializes concurrent reservations against the child cap, not the owner cap', async () => {
    const { owner, child } = await sharedAccounts(100)
    const results = await Promise.allSettled([0, 1].map((attempt) =>
      asChild(owner.id, child.id, () => freezeBalance(owner.id, 0.6, { idempotencyKey: `child-cap-${attempt}` }))))
    const fulfilled = results.filter((result) => result.status === 'fulfilled')
    const rejected = results.filter((result) => result.status === 'rejected')
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(DailyLimitExceededError)
    expect(await getBalance(owner.id)).toMatchObject({ balance: 9.4, frozenAmount: 0.6 })
    expect(await getBalance(child.id)).toMatchObject({ balance: 0, frozenAmount: 0 })
    expect(await getDailyUsageSnapshot(child.id)).toMatchObject({ usedPoints: 60, remainingPoints: 40 })
    expect(await getDailyUsageSnapshot(owner.id)).toMatchObject({ usedPoints: 0 })
    expect(await prisma.balanceFreeze.count()).toBe(1)
  })

  it('allows an unlimited zero-balance child to use the shared wallet and attributes settlement correctly', async () => {
    const { owner, child } = await sharedAccounts(null)
    const project = await createTestProject(owner.id)
    const freezeId = await asChild(owner.id, child.id, () => freezeBalance(owner.id, 1))
    expect(freezeId).toEqual(expect.any(String))
    expect(await confirmChargeWithRecord(freezeId!, {
      projectId: project.id, action: 'shared-wallet-regression', apiType: 'video',
      model: 'nori::norivideo2.5', quantity: 5, unit: 'second',
    }, { chargedAmount: 0.8 })).toBe(true)
    expect(await getBalance(owner.id)).toMatchObject({ balance: 9.2, frozenAmount: 0, totalSpent: 0.8 })
    expect(await getBalance(child.id)).toMatchObject({ balance: 0, totalSpent: 0 })
    expect(await getDailyUsageSnapshot(child.id)).toMatchObject({ limitPoints: null, consumedPoints: 80, pendingPoints: 0 })
    expect(await getDailyUsageSnapshot(owner.id)).toMatchObject({ usedPoints: 0 })
  })

  it('still rejects zero personal caps and empty shared wallets without consuming money', async () => {
    const { owner, child } = await sharedAccounts(0)
    await expect(asChild(owner.id, child.id, () => freezeBalance(owner.id, 1)))
      .rejects.toMatchObject({ limitPoints: 0 })
    await prisma.user.update({ where: { id: child.id }, data: { dailyPointLimit: null } })
    await seedBalance(owner.id, 0)
    expect(await asChild(owner.id, child.id, () => freezeBalance(owner.id, 1))).toBeNull()
    expect(await prisma.balanceFreeze.count()).toBe(0)
    expect(await getBalance(owner.id)).toMatchObject({ balance: 0, frozenAmount: 0 })
  })

  it('returns pending personal quota on failure so another request can use it', async () => {
    const { owner, child } = await sharedAccounts(100)
    const first = await asChild(owner.id, child.id, () => freezeBalance(owner.id, 1))
    expect(await getDailyUsageSnapshot(child.id)).toMatchObject({ usedPoints: 100, exceeded: true })
    expect(await rollbackFreeze(first!)).toBe(true)
    expect(await getDailyUsageSnapshot(child.id)).toMatchObject({ usedPoints: 0, exceeded: false })
    const retry = await asChild(owner.id, child.id, () => freezeBalance(owner.id, 1))
    expect(retry).toEqual(expect.any(String))
    expect(await getBalance(owner.id)).toMatchObject({ balance: 9, frozenAmount: 1 })
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
