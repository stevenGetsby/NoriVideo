import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import { calcVoice } from '@/lib/billing/cost'
import { getDailyUsageSnapshot } from '@/lib/billing/daily-limit'
import { InsufficientBalanceError } from '@/lib/billing/errors'
import { freezeBalance, getBalance, rollbackFreeze } from '@/lib/billing/ledger'
import { prepareTaskBilling, settleTaskBilling, withVoiceBilling } from '@/lib/billing/service'
import { buildDefaultTaskBillingInfo } from '@/lib/billing/task-policy'
import { TASK_TYPE, type TaskBillingInfo } from '@/lib/task/types'
import { setAccountActorContext, withAccountPermissionContext } from '@/lib/account/request-context'
import { prisma } from '../../helpers/prisma'
import { resetBillingState } from '../../helpers/db-reset'
import { createTestProject, createTestUser, seedBalance } from '../../helpers/billing-fixtures'

const VOICE_MODEL = 'nori::nori-audio'
const quoteFor = (seconds: number) => calcVoice(seconds, VOICE_MODEL)

async function sharedAccounts(options: {
  ownerBalance?: number
  childBalance?: number
  childMode?: 'unlimited' | 'allocated'
  limit?: number | null
} = {}) {
  const owner = await createTestUser()
  const child = await createTestUser()
  await prisma.user.update({ where: { id: owner.id }, data: { role: 'admin', dailyPointLimit: 0 } })
  await prisma.user.update({
    where: { id: child.id },
    data: {
      role: 'storyboard',
      workspaceOwnerId: owner.id,
      parentAccountId: owner.id,
      dailyPointLimit: options.limit ?? null,
      pointMode: options.childMode ?? 'unlimited',
    },
  })
  await seedBalance(owner.id, options.ownerBalance ?? 10)
  await seedBalance(child.id, options.childBalance ?? 0)
  return { owner, child }
}

function asChild<T>(ownerId: string, childId: string, run: () => T) {
  return withAccountPermissionContext([], () => {
    setAccountActorContext(childId, ownerId)
    return run()
  })
}

function expectBillable(info: TaskBillingInfo | null | undefined): Extract<TaskBillingInfo, { billable: true }> {
  expect(info?.billable).toBe(true)
  if (!info || !info.billable) throw new Error('Expected billable task billing info')
  return info
}

async function autoFundedAmount(userId: string) {
  const rows = await prisma.balanceTransaction.findMany({
    where: { userId, type: 'auto_allocate_in' },
    select: { amount: true },
  })
  return rows.reduce((sum, row) => sum + Number(row.amount), 0)
}

describe('billing payer switch integration', () => {
  beforeEach(async () => {
    await resetBillingState()
    process.env.BILLING_MODE = 'ENFORCE'
  })

  it('sync billing freezes and settles in the acting member wallet', async () => {
    const { owner, child } = await sharedAccounts()
    const project = await createTestProject(owner.id)
    const quoted = quoteFor(5)
    const actual = quoteFor(2)

    const result = await asChild(owner.id, child.id, () => withVoiceBilling(owner.id, 5, {
      projectId: project.id,
      action: 'payer-switch-sync',
      metadata: { model: VOICE_MODEL },
    }, async () => ({ actualDurationSeconds: 2 })))

    expect(result).toEqual({ actualDurationSeconds: 2 })
    const childBalance = await getBalance(child.id)
    expect(childBalance.balance).toBeCloseTo(quoted - actual, 8)
    expect(childBalance.frozenAmount).toBe(0)
    expect(childBalance.totalSpent).toBeCloseTo(actual, 8)
    const ownerBalance = await getBalance(owner.id)
    expect(ownerBalance.balance).toBeCloseTo(10 - quoted, 8)
    expect(ownerBalance.frozenAmount).toBe(0)
    expect(ownerBalance.totalSpent).toBe(0)

    const freeze = await prisma.balanceFreeze.findFirst({ where: { source: 'sync' } })
    expect(freeze).toMatchObject({ userId: child.id, status: 'confirmed' })
    expect(JSON.parse(freeze?.metadata || '{}').quotaUserId).toBeUndefined()
    expect(await prisma.balanceTransaction.findFirst({ where: { type: 'consume' } }))
      .toMatchObject({ userId: child.id })
    expect(await prisma.usageCost.findFirst()).toMatchObject({ userId: child.id })
  })

  it('task billing settles against the member after the request actor context is gone', async () => {
    const { owner, child } = await sharedAccounts()
    const project = await createTestProject(owner.id)
    const taskId = randomUUID()
    const quoted = quoteFor(5)
    const actual = quoteFor(2)
    const billingInfo = buildDefaultTaskBillingInfo(TASK_TYPE.VOICE_LINE, { maxSeconds: 5, model: VOICE_MODEL })!

    const prepared = expectBillable(await asChild(owner.id, child.id, () => prepareTaskBilling({
      id: taskId,
      userId: owner.id,
      projectId: project.id,
      billingInfo,
    })))
    expect(prepared.status).toBe('frozen')
    const pendingFreeze = await prisma.balanceFreeze.findUnique({ where: { id: prepared.freezeId! } })
    expect(pendingFreeze?.userId).toBe(child.id)
    expect(Number(pendingFreeze?.amount)).toBeCloseTo(quoted, 8)

    // The worker settles outside the original HTTP actor context. The freeze
    // row, not the current ALS scope, owns the payer.
    const settled = expectBillable(await settleTaskBilling({
      id: taskId,
      userId: owner.id,
      projectId: project.id,
      billingInfo: prepared,
    }, { result: { actualDurationSeconds: 2 } }))

    expect(settled.status).toBe('settled')
    expect(settled.chargedCost).toBeCloseTo(actual, 8)
    const childBalance = await getBalance(child.id)
    expect(childBalance.balance).toBeCloseTo(quoted - actual, 8)
    expect(childBalance.frozenAmount).toBe(0)
    expect(childBalance.totalSpent).toBeCloseTo(actual, 8)
    const ownerBalance = await getBalance(owner.id)
    expect(ownerBalance.balance).toBeCloseTo(10 - quoted, 8)
    expect(ownerBalance.frozenAmount).toBe(0)
    expect(ownerBalance.totalSpent).toBe(0)
  })

  it('coverage top-up auto-funds only the overage from the manager', async () => {
    const { owner, child } = await sharedAccounts()
    const project = await createTestProject(owner.id)
    const taskId = randomUUID()
    const quoted = quoteFor(2)
    const actual = quoteFor(5)
    const billingInfo = buildDefaultTaskBillingInfo(TASK_TYPE.VOICE_LINE, { maxSeconds: 2, model: VOICE_MODEL })!

    const prepared = expectBillable(await asChild(owner.id, child.id, () => prepareTaskBilling({
      id: taskId,
      userId: owner.id,
      projectId: project.id,
      billingInfo,
    })))
    const funded = await getBalance(child.id)
    expect(funded.balance).toBe(0)
    expect(funded.frozenAmount).toBeCloseTo(quoted, 8)

    const settled = expectBillable(await settleTaskBilling({
      id: taskId,
      userId: owner.id,
      projectId: project.id,
      billingInfo: prepared,
    }, { result: { actualDurationSeconds: 5 } }))

    expect(settled.chargedCost).toBeCloseTo(actual, 8)
    expect(await getBalance(child.id)).toMatchObject({ balance: 0, frozenAmount: 0, totalSpent: actual })
    expect((await getBalance(owner.id)).balance).toBeCloseTo(10 - actual, 8)
    expect(await autoFundedAmount(child.id)).toBeCloseTo(actual, 8)
    const settledFreeze = await prisma.balanceFreeze.findUnique({ where: { id: prepared.freezeId! } })
    expect(Number(settledFreeze?.amount)).toBeCloseTo(actual, 8)
    expect(settledFreeze?.status).toBe('confirmed')
  })

  it('keeps two acting members on separate wallets for tasks in the same manager project', async () => {
    const { owner, child } = await sharedAccounts()
    const childB = await createTestUser()
    await prisma.user.update({
      where: { id: childB.id },
      data: { role: 'storyboard', workspaceOwnerId: owner.id, parentAccountId: owner.id, pointMode: 'unlimited' },
    })
    await seedBalance(childB.id, 0)
    const project = await createTestProject(owner.id)
    const quoted = quoteFor(5)
    const billingInfo = buildDefaultTaskBillingInfo(TASK_TYPE.VOICE_LINE, { maxSeconds: 5, model: VOICE_MODEL })!

    const preparedA = expectBillable(await asChild(owner.id, child.id, () => prepareTaskBilling({
      id: randomUUID(), userId: owner.id, projectId: project.id, billingInfo,
    })))
    const preparedB = expectBillable(await asChild(owner.id, childB.id, () => prepareTaskBilling({
      id: randomUUID(), userId: owner.id, projectId: project.id, billingInfo,
    })))

    const freezeA = await prisma.balanceFreeze.findUnique({ where: { id: preparedA.freezeId! } })
    const freezeB = await prisma.balanceFreeze.findUnique({ where: { id: preparedB.freezeId! } })
    expect(freezeA?.userId).toBe(child.id)
    expect(freezeB?.userId).toBe(childB.id)
    const ownerBalance = await getBalance(owner.id)
    expect(ownerBalance.balance).toBeCloseTo(10 - quoted * 2, 8)
    expect(ownerBalance.frozenAmount).toBe(0)
    for (const memberId of [child.id, childB.id]) {
      const memberBalance = await getBalance(memberId)
      expect(memberBalance.balance).toBe(0)
      expect(memberBalance.frozenAmount).toBeCloseTo(quoted, 8)
    }
  })

  it('lets a manager pay from their own wallet without auto top-up', async () => {
    const manager = await createTestUser()
    await prisma.user.update({ where: { id: manager.id }, data: { role: 'admin' } })
    await seedBalance(manager.id, 10)
    const project = await createTestProject(manager.id)
    const taskId = randomUUID()
    const quoted = quoteFor(5)

    const prepared = expectBillable(await withAccountPermissionContext([], () => {
      setAccountActorContext(manager.id, manager.id)
      return prepareTaskBilling({
        id: taskId,
        userId: manager.id,
        projectId: project.id,
        billingInfo: buildDefaultTaskBillingInfo(TASK_TYPE.VOICE_LINE, { maxSeconds: 5, model: VOICE_MODEL })!,
      })
    }))

    const managerFreeze = await prisma.balanceFreeze.findUnique({ where: { id: prepared.freezeId! } })
    expect(managerFreeze?.userId).toBe(manager.id)
    expect(Number(managerFreeze?.amount)).toBeCloseTo(quoted, 8)
    expect(await prisma.balanceTransaction.count({ where: { type: { startsWith: 'auto_allocate' } } })).toBe(0)
    const managerBalance = await getBalance(manager.id)
    expect(managerBalance.balance).toBeCloseTo(10 - quoted, 8)
    expect(managerBalance.frozenAmount).toBeCloseTo(quoted, 8)
  })

  it('auto-funds only the shortfall of a partially funded member', async () => {
    const { owner, child } = await sharedAccounts({ childBalance: 0.4 })
    const freezeId = await asChild(owner.id, child.id, () => freezeBalance(child.id, 1, {
      idempotencyKey: 'partial-top-up',
    }))

    expect(freezeId).toEqual(expect.any(String))
    const childBalance = await getBalance(child.id)
    expect(childBalance.balance).toBe(0)
    expect(childBalance.frozenAmount).toBeCloseTo(1, 8)
    expect((await getBalance(owner.id)).balance).toBeCloseTo(9.4, 8)
    expect(await autoFundedAmount(child.id)).toBeCloseTo(0.6, 8)
    expect(await prisma.balanceTransaction.count({ where: { type: 'auto_allocate_out', userId: owner.id } })).toBe(1)
  })

  it('fails atomically when the manager cannot cover the shortfall', async () => {
    const { owner, child } = await sharedAccounts({ ownerBalance: 0.5 })
    expect(await asChild(owner.id, child.id, () => freezeBalance(child.id, 1, {
      idempotencyKey: 'manager-short',
    }))).toBeNull()

    expect(await getBalance(owner.id)).toMatchObject({ balance: 0.5, frozenAmount: 0 })
    expect(await getBalance(child.id)).toMatchObject({ balance: 0, frozenAmount: 0 })
    expect(await prisma.balanceFreeze.count()).toBe(0)
    expect(await prisma.balanceTransaction.count()).toBe(0)
  })

  it('allocated members spend only their own allocation and never auto-fund', async () => {
    const { owner, child } = await sharedAccounts({ childBalance: 1, childMode: 'allocated' })
    const first = await asChild(owner.id, child.id, () => freezeBalance(child.id, 1, {
      idempotencyKey: 'allocated-own',
    }))
    expect(first).toEqual(expect.any(String))
    expect(await getBalance(owner.id)).toMatchObject({ balance: 10, frozenAmount: 0 })
    expect(await autoFundedAmount(child.id)).toBe(0)

    await rollbackFreeze(first!)
    await seedBalance(child.id, 0)
    expect(await asChild(owner.id, child.id, () => freezeBalance(child.id, 1, {
      idempotencyKey: 'allocated-empty',
    }))).toBeNull()
    expect(await getBalance(owner.id)).toMatchObject({ balance: 10, frozenAmount: 0 })

    const project = await createTestProject(owner.id)
    let rejection: unknown
    try {
      await asChild(owner.id, child.id, () => prepareTaskBilling({
        id: randomUUID(),
        userId: child.id,
        projectId: project.id,
        billingInfo: buildDefaultTaskBillingInfo(TASK_TYPE.VOICE_LINE, { maxSeconds: 1, model: VOICE_MODEL })!,
      }))
    } catch (error) {
      rejection = error
    }
    expect(rejection).toBeInstanceOf(InsufficientBalanceError)
    expect((rejection as Error).message).toContain('联系管理账号给你分配积分')
  })

  it('reads the current point mode inside each reservation', async () => {
    const { owner, child } = await sharedAccounts()
    const funded = await asChild(owner.id, child.id, () => freezeBalance(child.id, 1, { idempotencyKey: 'mode-on' }))
    expect(funded).toEqual(expect.any(String))
    await rollbackFreeze(funded!)
    await seedBalance(child.id, 0)

    await prisma.user.update({ where: { id: child.id }, data: { pointMode: 'allocated' } })
    expect(await asChild(owner.id, child.id, () => freezeBalance(child.id, 1, { idempotencyKey: 'mode-off' })))
      .toBeNull()
    expect((await getBalance(owner.id)).balance).toBeCloseTo(9, 8)

    await prisma.user.update({ where: { id: child.id }, data: { pointMode: 'unlimited' } })
    expect(await asChild(owner.id, child.id, () => freezeBalance(child.id, 1, { idempotencyKey: 'mode-back' })))
      .toEqual(expect.any(String))
    expect((await getBalance(owner.id)).balance).toBeCloseTo(8, 8)
    expect(await getBalance(child.id)).toMatchObject({ balance: 0, frozenAmount: 1 })
  })

  it('replaces a forged quotaUserId with the trusted actor on legacy freezes', async () => {
    const { owner, child } = await sharedAccounts()
    const freezeId = await asChild(owner.id, child.id, () => freezeBalance(owner.id, 1, {
      idempotencyKey: 'forged-quota',
      metadata: { quotaUserId: 'forged-operator', reason: 'legacy-caller' },
    }))

    const freeze = await prisma.balanceFreeze.findUnique({ where: { id: freezeId! } })
    const metadata = JSON.parse(freeze?.metadata || '{}')
    expect(freeze?.userId).toBe(owner.id)
    expect(metadata.quotaUserId).toBe(child.id)
    expect(metadata.reason).toBe('legacy-caller')
  })

  it('settles a pre-switch freeze against the manager wallet even after the switch', async () => {
    const { owner, child } = await sharedAccounts()
    const project = await createTestProject(owner.id)
    const taskId = randomUUID()
    const quoted = quoteFor(2)
    const actual = quoteFor(5)

    // Simulate a task frozen before the payer switch: manager wallet, with the
    // acting child recorded only as the daily-quota owner.
    const freezeId = await asChild(owner.id, child.id, () => freezeBalance(owner.id, quoted, {
      source: 'task',
      taskId,
      idempotencyKey: 'legacy-in-flight',
      metadata: { quotaUserId: child.id },
    }))
    expect(freezeId).toEqual(expect.any(String))

    const settled = expectBillable(await settleTaskBilling({
      id: taskId,
      userId: owner.id,
      projectId: project.id,
      billingInfo: {
        billable: true,
        source: 'task',
        taskType: TASK_TYPE.VOICE_LINE,
        apiType: 'voice',
        model: VOICE_MODEL,
        quantity: 2,
        unit: 'second',
        maxFrozenCost: quoted,
        action: TASK_TYPE.VOICE_LINE,
        metadata: {},
        status: 'frozen',
        freezeId: freezeId!,
        modeSnapshot: 'ENFORCE',
        billingKey: taskId,
      },
    }, { result: { actualDurationSeconds: 5 } }))

    expect(settled.chargedCost).toBeCloseTo(actual, 8)
    expect((await getBalance(owner.id)).balance).toBeCloseTo(10 - actual, 8)
    expect((await getBalance(owner.id)).totalSpent).toBeCloseTo(actual, 8)
    expect(await getBalance(child.id)).toMatchObject({ balance: 0, frozenAmount: 0, totalSpent: 0 })
    expect(await prisma.balanceTransaction.count({ where: { type: { startsWith: 'auto_allocate' } } })).toBe(0)
  })

  it('attributes daily usage to the member before and after the payer switch', async () => {
    const { owner, child } = await sharedAccounts()

    const legacyFreeze = await asChild(owner.id, child.id, () => freezeBalance(owner.id, 1, {
      idempotencyKey: 'legacy-daily',
      metadata: { quotaUserId: child.id },
    }))
    expect(await getDailyUsageSnapshot(child.id)).toMatchObject({ usedPoints: 100, pendingPoints: 100 })
    expect(await getDailyUsageSnapshot(owner.id)).toMatchObject({ usedPoints: 0 })
    expect(await rollbackFreeze(legacyFreeze!)).toBe(true)
    expect(await getDailyUsageSnapshot(child.id)).toMatchObject({ usedPoints: 0 })

    const switchedFreeze = await asChild(owner.id, child.id, () => freezeBalance(child.id, 1, {
      idempotencyKey: 'switched-daily',
    }))
    expect(switchedFreeze).toEqual(expect.any(String))
    expect(await prisma.balanceFreeze.findUnique({ where: { id: switchedFreeze! } }))
      .toMatchObject({ userId: child.id })
    expect(await getDailyUsageSnapshot(child.id)).toMatchObject({ usedPoints: 100, pendingPoints: 100 })
    expect(await getDailyUsageSnapshot(owner.id)).toMatchObject({ usedPoints: 0 })
  })
})
