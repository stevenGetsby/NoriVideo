import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  balance: 12.5,
  transactionExists: false,
}))

const txMock = vi.hoisted(() => ({
  userBalance: {
    upsert: vi.fn(async (input: { create: { balance: number }; update: { balance?: { increment: number } } }) => {
      if (input.update.balance?.increment) state.balance += input.update.balance.increment
      return { balance: state.balance }
    }),
  },
  balanceTransaction: {
    findFirst: vi.fn(async () => state.transactionExists ? { amount: 7.5 } : null),
    create: vi.fn(async () => {
      state.transactionExists = true
      return { id: 'tx-created' }
    }),
  },
}))

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(async (callback: (tx: typeof txMock) => Promise<unknown>) => await callback(txMock)),
  userBalance: txMock.userBalance,
  balanceTransaction: txMock.balanceTransaction,
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

import { rechargeAccountPoints } from '@/lib/billing/credit-ledger'

describe('account credit ledger', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.balance = 12.5
    state.transactionExists = false
  })

  it('adds recharged points to the existing balance and keeps retries idempotent', async () => {
    const first = await rechargeAccountPoints('manager-1', 750, {
      operatorId: 'admin-1',
      idempotencyKey: 'recharge-1',
      note: '测试充值',
    })

    expect(first.target.balancePoints).toBe(2_000)
    expect(first.idempotent).toBe(false)
    expect(txMock.userBalance.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: { balance: { increment: 7.5 } },
    }))

    const retry = await rechargeAccountPoints('manager-1', 750, {
      operatorId: 'admin-1',
      idempotencyKey: 'recharge-1',
    })
    expect(retry.target.balancePoints).toBe(2_000)
    expect(retry.idempotent).toBe(true)
    expect(state.balance).toBe(20)
  })

  it('rejects reuse of one request key with a different amount', async () => {
    await rechargeAccountPoints('manager-1', 750, {
      operatorId: 'admin-1',
      idempotencyKey: 'recharge-conflict',
    })

    await expect(rechargeAccountPoints('manager-1', 500, {
      operatorId: 'admin-1',
      idempotencyKey: 'recharge-conflict',
    })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' })
    expect(state.balance).toBe(20)
  })

  it('turns a concurrent unique collision into an idempotent replay', async () => {
    state.transactionExists = true
    const collision = Object.assign(new Error('duplicate'), { code: 'P2002' })
    prismaMock.$transaction.mockRejectedValueOnce(collision)

    const result = await rechargeAccountPoints('manager-1', 750, {
      operatorId: 'admin-1',
      idempotencyKey: 'recharge-concurrent',
    })

    expect(result.idempotent).toBe(true)
    expect(result.target.balancePoints).toBe(1_250)
    expect(state.balance).toBe(12.5)
  })
})
