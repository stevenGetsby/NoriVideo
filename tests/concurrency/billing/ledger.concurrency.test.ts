import { beforeEach, describe, expect, it } from 'vitest'
import { calcText } from '@/lib/billing/cost'
import { GENERATION_CREDIT_FLOOR_CNY } from '@/lib/billing/credit-policy'
import {
  confirmChargeWithRecord,
  freezeBalance,
  getBalance,
  rollbackFreeze,
} from '@/lib/billing/ledger'
import { withTextBilling } from '@/lib/billing/service'
import { allocateAccountPoints, rechargeAccountPoints } from '@/lib/billing/credit-ledger'
import { prisma } from '../../helpers/prisma'
import { resetBillingState } from '../../helpers/db-reset'
import { createTestProject, createTestUser, seedBalance } from '../../helpers/billing-fixtures'
import { expectNoNegativeLedger } from '../../helpers/assertions'

describe('billing/concurrency', () => {
  beforeEach(async () => {
    await resetBillingState()
    process.env.BILLING_MODE = 'ENFORCE'
  })

  it('never exceeds the configured generation credit floor under high-concurrency freezes', async () => {
    const user = await createTestUser()
    await seedBalance(user.id, 10)

    const attempts = Array.from({ length: 40 }, (_, idx) =>
      freezeBalance(user.id, 1, { idempotencyKey: `concurrency_freeze_${idx}` }))
    const freezeIds = await Promise.all(attempts)
    const successCount = freezeIds.filter(Boolean).length

    const balance = await getBalance(user.id)
    const maximumSettledAttempts = Math.floor(10 - GENERATION_CREDIT_FLOOR_CNY)
    expect(successCount).toBeLessThanOrEqual(maximumSettledAttempts)
    expect(balance.balance).toBeCloseTo(10 - successCount, 8)
    expect(balance.frozenAmount).toBeCloseTo(successCount, 8)
    expect(balance.balance).toBeGreaterThanOrEqual(GENERATION_CREDIT_FLOOR_CNY)
    expect(balance.frozenAmount).toBeGreaterThanOrEqual(0)
  })

  it('applies idempotency key correctly under concurrent duplicate requests', async () => {
    const user = await createTestUser()
    await seedBalance(user.id, 10)

    const attempts = Array.from({ length: 20 }, () =>
      freezeBalance(user.id, 2, { idempotencyKey: 'same_key_concurrency' }))
    const freezeIds = await Promise.all(attempts)
    const uniqueIds = new Set(freezeIds.filter(Boolean))

    expect(uniqueIds.size).toBe(1)
    const balance = await getBalance(user.id)
    expect(balance.balance).toBeCloseTo(8, 8)
    expect(balance.frozenAmount).toBeCloseTo(2, 8)
    expect(await prisma.balanceFreeze.count()).toBe(1)
  })

  it('credits one recharge exactly once under concurrent duplicate submissions', async () => {
    const manager = await createTestUser()
    await seedBalance(manager.id, 0)

    const attempts = Array.from({ length: 12 }, () => rechargeAccountPoints(manager.id, 250, {
      operatorId: 'platform-admin',
      idempotencyKey: 'same_recharge_concurrency',
    }))
    const results = await Promise.all(attempts)

    expect(results.some((result) => result.idempotent === false)).toBe(true)
    expect((await getBalance(manager.id)).balance).toBeCloseTo(2.5, 8)
    expect(await prisma.balanceTransaction.count({
      where: { userId: manager.id, type: 'recharge', idempotencyKey: 'same_recharge_concurrency' },
    })).toBe(1)
  })

  it('moves one allocation exactly once under concurrent duplicate submissions', async () => {
    const manager = await createTestUser()
    const member = await createTestUser()
    await seedBalance(manager.id, 10)
    await seedBalance(member.id, 0)

    const attempts = Array.from({ length: 12 }, () => allocateAccountPoints(manager.id, member.id, 200, {
      operatorId: manager.id,
      idempotencyKey: 'same_allocate_concurrency',
    }))
    await Promise.all(attempts)

    expect((await getBalance(manager.id)).balance).toBeCloseTo(8, 8)
    expect((await getBalance(member.id)).balance).toBeCloseTo(2, 8)
    expect(await prisma.balanceTransaction.count({
      where: { idempotencyKey: 'same_allocate_concurrency' },
    })).toBe(2)
  })

  it('keeps a valid final state when confirm and rollback race', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    await seedBalance(user.id, 10)

    const freezeId = await freezeBalance(user.id, 5, { idempotencyKey: 'race_key' })
    expect(freezeId).toBeTruthy()

    const [confirmResult, rollbackResult] = await Promise.allSettled([
      confirmChargeWithRecord(
        freezeId!,
        {
          projectId: project.id,
          action: 'race_confirm',
          apiType: 'text',
          model: 'anthropic/claude-sonnet-4',
          quantity: 10,
          unit: 'token',
        },
        { chargedAmount: 3 },
      ),
      rollbackFreeze(freezeId!),
    ])

    expect(['fulfilled', 'rejected']).toContain(confirmResult.status)
    expect(['fulfilled', 'rejected']).toContain(rollbackResult.status)
    expect(confirmResult.status === 'fulfilled' || rollbackResult.status === 'fulfilled').toBe(true)

    const freeze = await prisma.balanceFreeze.findUnique({ where: { id: freezeId! } })
    expect(['confirmed', 'rolled_back']).toContain(freeze?.status)

    const balance = await getBalance(user.id)
    if (freeze?.status === 'confirmed') {
      expect(balance.balance).toBeCloseTo(7, 8)
      expect(balance.totalSpent).toBeCloseTo(3, 8)
    } else {
      expect(balance.balance).toBeCloseTo(10, 8)
      expect(balance.totalSpent).toBeCloseTo(0, 8)
    }
    expect(balance.frozenAmount).toBeCloseTo(0, 8)
    await expectNoNegativeLedger(user.id)
  })

  it('prevents duplicate consumption on retried sync billing with same requestId', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    await seedBalance(user.id, 5)

    let providerCalls = 0
    const attempt = () =>
      withTextBilling(
        user.id,
        'anthropic/claude-sonnet-4',
        1000,
        500,
        {
          projectId: project.id,
          action: 'retry_no_double_charge',
          requestId: 'fixed_request_id',
        },
        async () => { providerCalls++; return { ok: true } },
      )

    const results = await Promise.allSettled([attempt(), attempt(), attempt()])
    expect(results.some((item) => item.status === 'fulfilled')).toBe(true)
    expect(providerCalls).toBe(1)

    const balance = await getBalance(user.id)
    const expected = calcText('anthropic/claude-sonnet-4', 1000, 500)
    expect(balance.totalSpent).toBeLessThanOrEqual(expected + 1e-8)
    expect(await prisma.balanceFreeze.count()).toBe(1)
    expect(await prisma.balanceTransaction.count({ where: { type: 'consume' } })).toBeLessThanOrEqual(1)
    await expectNoNegativeLedger(user.id)
  })
})
