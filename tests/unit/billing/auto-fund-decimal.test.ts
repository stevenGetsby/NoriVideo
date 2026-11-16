import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Prisma } from '@prisma/client'

const state = vi.hoisted(() => ({
  payerBalance: 0,
  managerBalance: 1000,
  reservations: [] as Array<{ gteType: string; gteValue: string }>,
}))

const prismaMock = vi.hoisted(() => ({
  user: {
    findMany: vi.fn(async () => []),
    findUnique: vi.fn(async () => ({ role: 'member', workspaceOwnerId: 'manager', pointMode: 'unlimited' })),
  },
  balanceTransaction: {
    groupBy: vi.fn(async () => []),
  },
  balanceFreeze: {
    findUnique: vi.fn(async () => null),
    create: vi.fn(async () => ({})),
    groupBy: vi.fn(async () => []),
  },
  userBalance: {
    findUnique: vi.fn(async () => ({ balance: new Prisma.Decimal(state.payerBalance) })),
    create: vi.fn(async () => ({})),
    updateMany: vi.fn(),
  },
  $queryRaw: vi.fn(),
  $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(prismaMock)),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/logging/core', () => ({
  logInfo: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
}))

import { freezeBalance } from '@/lib/billing/ledger'

// 近 30 天真实触发过「等于被判成小于」的 4 个报价：本人余额不足、需管理账号补足，
// 补足后余额正好等于报价。旧代码把 JS number 绑进 DECIMAL 比较，第二次校验返回 0 行，
// 抛 BILLING_AUTO_FUND_FAILED 并回滚整个事务，节点保持空。
const FLOAT_TRAP_QUOTES = [9.583602, 9.14004, 9.84312, 9.544332]

describe('billing/auto-fund 精确补足', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.payerBalance = 0.546756
    state.managerBalance = 1000
    state.reservations = []
    prismaMock.user.findMany.mockResolvedValue([])
    prismaMock.balanceTransaction.groupBy.mockResolvedValue([])
    prismaMock.balanceFreeze.groupBy.mockResolvedValue([])
    prismaMock.balanceFreeze.findUnique.mockResolvedValue(null)
    prismaMock.$transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback(prismaMock))
    prismaMock.userBalance.findUnique.mockImplementation(async () => ({ balance: new Prisma.Decimal(state.payerBalance) }))
    prismaMock.$queryRaw.mockImplementation(async (query: { strings: string[] }) => {
      if (query.strings.join(' ').includes('FROM user WHERE')) {
        return [{ id: 'payer', pointMode: 'unlimited', workspaceOwnerId: 'manager' }]
      }
      return [{ balance: new Prisma.Decimal(state.payerBalance) }]
    })
    // First reserve fails (shortfall), second one runs after the top-up and must match exactly.
    prismaMock.userBalance.updateMany.mockImplementation(async (args: {
      where: { balance: { gte: unknown } }
      data: { balance: { decrement: number }; frozenAmount: { increment: number } }
    }) => {
      const gte = args.where.balance.gte
      state.reservations.push({
        gteType: gte instanceof Prisma.Decimal ? 'Decimal' : typeof gte,
        gteValue: String(gte),
      })
      if (state.payerBalance < Number(gte)) return { count: 0 }
      state.payerBalance -= args.data.balance.decrement
      return { count: 1 }
    })
  })

  it.each(FLOAT_TRAP_QUOTES)('报价 %s 补足到与报价完全相等时仍能冻结，两次校验都绑定 DECIMAL', async (quote) => {
    const shortfall = Math.round((quote - state.payerBalance) * 1e6) / 1e6
    const creditLedger = await import('@/lib/billing/credit-ledger')
    const transferSpy = vi.spyOn(creditLedger, 'transferPointsInTx').mockImplementation(async (_tx, input) => {
      state.managerBalance -= input.amountCny
      state.payerBalance = Math.round((state.payerBalance + input.amountCny) * 1e6) / 1e6
      return {} as never
    })
    try {
      const freezeId = await freezeBalance('payer', quote, { source: 'task' })
      expect(typeof freezeId).toBe('string')
      expect(transferSpy).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ amountCny: shortfall }))
      expect(state.reservations).toHaveLength(2)
      // 关键回归点：校验参数必须是 Prisma.Decimal，而不是会被 MySQL 当 DOUBLE 的 JS number。
      expect(state.reservations[0].gteType).toBe('Decimal')
      expect(state.reservations[1].gteType).toBe('Decimal')
      expect(new Prisma.Decimal(state.reservations[1].gteValue).toFixed(6)).toBe(quote.toFixed(6))
    } finally {
      transferSpy.mockRestore()
    }
  })

  it('本人余额足够时直接冻结，不触发补足，校验仍绑定 DECIMAL', async () => {
    state.payerBalance = 20
    const creditLedger = await import('@/lib/billing/credit-ledger')
    const transferSpy = vi.spyOn(creditLedger, 'transferPointsInTx')
    try {
      const freezeId = await freezeBalance('payer', 9.583602, { source: 'task' })
      expect(typeof freezeId).toBe('string')
      expect(transferSpy).not.toHaveBeenCalled()
      expect(state.reservations).toHaveLength(1)
      expect(state.reservations[0].gteType).toBe('Decimal')
      expect(new Prisma.Decimal(state.reservations[0].gteValue).toFixed(6)).toBe((9.583602).toFixed(6))
    } finally {
      transferSpy.mockRestore()
    }
  })

  it('管理账号也补不足时返回 null，不误抛 AUTO_FUND_FAILED、不动账', async () => {
    const creditLedger = await import('@/lib/billing/credit-ledger')
    const transferSpy = vi.spyOn(creditLedger, 'transferPointsInTx').mockImplementation(async () => {
      throw new creditLedger.CreditLedgerError('INSUFFICIENT_POINTS', '可用积分不足，无法完成此次操作。')
    })
    try {
      const before = state.payerBalance
      await expect(freezeBalance('payer', 9.583602, { source: 'task' })).resolves.toBeNull()
      expect(state.payerBalance).toBe(before)
      expect(state.reservations).toHaveLength(1)
    } finally {
      transferSpy.mockRestore()
    }
  })
})
