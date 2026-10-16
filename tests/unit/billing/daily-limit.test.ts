import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(async () => ({ dailyPointLimit: null })),
    findMany: vi.fn(async () => [] as Array<{ id: string; dailyPointLimit: number | null; workspaceOwnerId?: string | null; role?: string }>),
  },
  balanceTransaction: {
    aggregate: vi.fn(async () => ({ _sum: { amount: null } })),
    groupBy: vi.fn(async () => [] as Array<{ userId: string; _sum: { amount: unknown } }>),
    findMany: vi.fn(async () => [] as Array<{ userId: string; amount: number; billingMeta: string }>),
  },
  balanceFreeze: {
    aggregate: vi.fn(async () => ({ _sum: { amount: null } })),
    groupBy: vi.fn(async () => [] as Array<{ userId: string; _sum: { amount: unknown } }>),
    findMany: vi.fn(async () => [] as Array<{ userId: string; amount: number; metadata: string }>),
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

import {
  DAILY_LIMIT_TIME_ZONE,
  assertDailyLimit,
  getDailyUsageSnapshot,
  getDailyUsageSnapshotMap,
  isValidDailyPointLimitInput,
  normalizeDailyPointLimit,
  resolveDailyUsageWindow,
  serializeDailyUsage,
} from '@/lib/billing/daily-limit'
import { DailyLimitExceededError } from '@/lib/billing/errors'
import { withAccountPermissionContext, setAccountActorContext } from '@/lib/account/request-context'

describe('billing/daily-limit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.user.findUnique.mockResolvedValue({ dailyPointLimit: null })
    prismaMock.user.findMany.mockResolvedValue([])
    prismaMock.balanceTransaction.aggregate.mockResolvedValue({ _sum: { amount: null } })
    prismaMock.balanceFreeze.aggregate.mockResolvedValue({ _sum: { amount: null } })
    prismaMock.balanceTransaction.groupBy.mockResolvedValue([])
    prismaMock.balanceFreeze.groupBy.mockResolvedValue([])
    prismaMock.balanceTransaction.findMany.mockResolvedValue([])
    prismaMock.balanceFreeze.findMany.mockResolvedValue([])
  })

  describe('上海自然日窗口', () => {
    it('按 UTC+8 切分，而不是 UTC', () => {
      // 北京时间 2026-09-17 00:30 == UTC 2026-09-16 16:30
      const window = resolveDailyUsageWindow(new Date('2026-09-16T16:30:00.000Z'))
      expect(window.start.toISOString()).toBe('2026-09-16T16:00:00.000Z')
      expect(window.end.toISOString()).toBe('2026-09-17T16:00:00.000Z')
      expect(window.timeZone).toBe(DAILY_LIMIT_TIME_ZONE)
    })

    it('北京时间当天 23:59 仍属于同一天', () => {
      const window = resolveDailyUsageWindow(new Date('2026-09-17T15:59:59.000Z'))
      expect(window.start.toISOString()).toBe('2026-09-16T16:00:00.000Z')
    })

    it('跨过北京时间 00:00 后进入新窗口', () => {
      const window = resolveDailyUsageWindow(new Date('2026-09-17T16:00:00.000Z'))
      expect(window.start.toISOString()).toBe('2026-09-17T16:00:00.000Z')
    })
  })

  describe('上限值归一化', () => {
    it('unlimited/null 不限量，0 保留为禁用额度', () => {
      expect(normalizeDailyPointLimit(null)).toBeNull()
      expect(normalizeDailyPointLimit(undefined)).toBeNull()
      expect(normalizeDailyPointLimit('')).toBeNull()
      expect(normalizeDailyPointLimit('unlimited')).toBeNull()
      expect(normalizeDailyPointLimit(0)).toBe(0)
      expect(normalizeDailyPointLimit('0')).toBe(0)
      expect(normalizeDailyPointLimit(-5)).toBeNull()
    })

    it('仅接受整数积分，不静默向下取整', () => {
      expect(normalizeDailyPointLimit(1500)).toBe(1500)
      expect(normalizeDailyPointLimit('1500')).toBe(1500)
      expect(normalizeDailyPointLimit(1500.9)).toBeNull()
    })

    it('拒绝超出范围的入参', () => {
      expect(isValidDailyPointLimitInput(100_000_000)).toBe(true)
      expect(isValidDailyPointLimitInput(100_000_001)).toBe(false)
      expect(isValidDailyPointLimitInput('abc')).toBe(false)
      expect(isValidDailyPointLimitInput(null)).toBe(true)
      expect(isValidDailyPointLimitInput('unlimited')).toBe(true)
      for (const invalid of ['', ' ', -1, true, 0.5, '1.5']) {
        expect(isValidDailyPointLimitInput(invalid)).toBe(false)
      }
    })
  })

  describe('今日用量统计', () => {
    it('消费流水与在途冻结都计入当日用量', async () => {
      prismaMock.user.findMany.mockResolvedValue([{ id: 'u1', dailyPointLimit: 5000 }])
      // 已消耗 ¥12.3456，在途冻结 ¥1
      prismaMock.balanceTransaction.groupBy.mockResolvedValue([{ userId: 'u1', _sum: { amount: -12.3456 } }])
      prismaMock.balanceFreeze.groupBy.mockResolvedValue([{ userId: 'u1', _sum: { amount: 1 } }])

      const snapshot = await getDailyUsageSnapshot('u1', new Date('2026-09-17T02:00:00.000Z'))

      expect(snapshot.consumedPoints).toBeCloseTo(1234.56, 2)
      expect(snapshot.pendingPoints).toBeCloseTo(100, 2)
      expect(snapshot.usedPoints).toBeCloseTo(1334.56, 2)
      expect(snapshot.remainingPoints).toBeCloseTo(3665.44, 2)
      expect(snapshot.exceeded).toBe(false)
    })

    it('未设置上限时 remainingPoints 为 null', async () => {
      prismaMock.balanceTransaction.groupBy.mockResolvedValue([{ userId: 'u1', _sum: { amount: -1 } }])
      const snapshot = await getDailyUsageSnapshot('u1')
      expect(snapshot.limitPoints).toBeNull()
      expect(snapshot.remainingPoints).toBeNull()
      expect(snapshot.exceeded).toBe(false)
    })

    it('批量统计按用户拆分', async () => {
      prismaMock.user.findMany.mockResolvedValue([
        { id: 'u1', dailyPointLimit: 100 },
        { id: 'u2', dailyPointLimit: null },
      ])
      prismaMock.balanceTransaction.groupBy.mockResolvedValue([
        { userId: 'u1', _sum: { amount: -2 } },
      ])
      prismaMock.balanceFreeze.groupBy.mockResolvedValue([
        { userId: 'u2', _sum: { amount: 0.5 } },
      ])

      const map = await getDailyUsageSnapshotMap(['u1', 'u2', 'u1'])
      expect(Array.from(map.keys()).sort()).toEqual(['u1', 'u2'])
      expect(map.get('u1')?.usedPoints).toBeCloseTo(200, 2)
      expect(map.get('u1')?.limitPoints).toBe(100)
      expect(map.get('u2')?.usedPoints).toBeCloseTo(50, 2)
      expect(map.get('u2')?.limitPoints).toBeNull()
    })
  })

  describe('生成闸门', () => {
    it('共享工作区不能绕过实际操作子账号的 0 上限', async () => {
      prismaMock.user.findMany.mockResolvedValue([
        { id: 'manager', dailyPointLimit: null },
        { id: 'child', dailyPointLimit: 0, workspaceOwnerId: 'manager' },
      ])
      await withAccountPermissionContext([], async () => {
        setAccountActorContext('child', 'manager')
        await expect(assertDailyLimit('manager', { additionalCostCny: 1 })).rejects.toMatchObject({ limitPoints: 0 })
      })
      await expect(assertDailyLimit('manager', { additionalCostCny: 1 })).resolves.toBeTruthy()
    })
    it('每人额度独立：管理账号上限 0 不把 unlimited 子账号也禁用', async () => {
      prismaMock.user.findMany.mockResolvedValue([
        { id: 'manager', dailyPointLimit: 0, role: 'admin' },
        { id: 'child', dailyPointLimit: null, workspaceOwnerId: 'manager' },
      ])
      await withAccountPermissionContext([], async () => {
        setAccountActorContext('child', 'manager')
        await expect(assertDailyLimit('manager', { additionalCostCny: 1 })).resolves.toMatchObject({ limitPoints: null })
      })
      await expect(assertDailyLimit('manager')).rejects.toMatchObject({ limitPoints: 0 })
    })

    it('将共享钱包的冻结和实际消费计入操作人员，不计入其他子账号', async () => {
      prismaMock.user.findMany.mockResolvedValue([
        { id: 'child', dailyPointLimit: 500, workspaceOwnerId: 'manager' },
      ])
      prismaMock.balanceTransaction.findMany.mockResolvedValue([
        { userId: 'manager', amount: -2, billingMeta: '{"quotaUserId":"child"}' },
        { userId: 'manager', amount: -9, billingMeta: '{"quotaUserId":"another-child"}' },
      ])
      prismaMock.balanceFreeze.findMany.mockResolvedValue([
        { userId: 'manager', amount: 1, metadata: '{"quotaUserId":"child"}' },
      ])
      expect(await getDailyUsageSnapshot('child')).toMatchObject({ consumedPoints: 200, pendingPoints: 100, usedPoints: 300 })
      await withAccountPermissionContext([], async () => {
        setAccountActorContext('child', 'manager')
        await expect(assertDailyLimit('manager', { additionalCostCny: 3 })).rejects.toMatchObject({ limitPoints: 500, usedPoints: 300 })
      })
    })
    it('0 即使当天零消耗、零报价也禁止任何新生成', async () => {
      prismaMock.user.findMany.mockResolvedValue([{ id: 'u1', dailyPointLimit: 0 }])
      for (const cost of [undefined, 0, 1, 1e-12]) {
        await expect(assertDailyLimit('u1', { additionalCostCny: cost })).rejects.toMatchObject({ limitPoints: 0, usedPoints: 0 })
      }
      const snapshot = await getDailyUsageSnapshot('u1')
      expect(snapshot).toMatchObject({ limitPoints: 0, remainingPoints: 0, exceeded: true })
      const error = await assertDailyLimit('u1').catch((error: Error) => error)
      expect(error).toBeInstanceOf(DailyLimitExceededError)
      expect((error as Error).message).toContain('已禁止')
    })
    it('未设置上限时永远放行', async () => {
      prismaMock.balanceTransaction.groupBy.mockResolvedValue([{ userId: 'u1', _sum: { amount: -10_000 } }])
      await expect(assertDailyLimit('u1')).resolves.toBeTruthy()
    })

    it('已用满当日额度时抛错', async () => {
      prismaMock.user.findMany.mockResolvedValue([{ id: 'u1', dailyPointLimit: 1000 }])
      prismaMock.balanceTransaction.groupBy.mockResolvedValue([{ userId: 'u1', _sum: { amount: -10 } }])

      await expect(assertDailyLimit('u1')).rejects.toBeInstanceOf(DailyLimitExceededError)
      await expect(assertDailyLimit('u1')).rejects.toMatchObject({
        limitPoints: 1000,
        usedPoints: 1000,
      })
    })

    it('把本次报价一起预判，避免并发冲过上限', async () => {
      prismaMock.user.findMany.mockResolvedValue([{ id: 'u1', dailyPointLimit: 1000 }])
      prismaMock.balanceTransaction.groupBy.mockResolvedValue([{ userId: 'u1', _sum: { amount: -9 } }])

      // 已用 900，本次 ¥2 = 200 积分，超出 1000
      await expect(assertDailyLimit('u1', { additionalCostCny: 2 })).rejects.toMatchObject({
        limitPoints: 1000,
        usedPoints: 900,
        requestedPoints: 200,
      })
      // 同样的已用量，本次只要 ¥1 = 100 积分，刚好用满仍可放行
      await expect(assertDailyLimit('u1', { additionalCostCny: 1 })).resolves.toBeTruthy()
    })

    it('错误信息包含上限与用途提示', async () => {
      prismaMock.user.findMany.mockResolvedValue([{ id: 'u1', dailyPointLimit: 100 }])
      prismaMock.balanceTransaction.groupBy.mockResolvedValue([{ userId: 'u1', _sum: { amount: -2 } }])

      const error = await assertDailyLimit('u1').catch((caught: unknown) => caught)
      expect(error).toBeInstanceOf(DailyLimitExceededError)
      expect((error as Error).message).toContain('今日用量已达上限')
      expect((error as Error).message).toContain('200')
      expect(serializeDailyUsage(await getDailyUsageSnapshot('u1'))).toMatchObject({
        timeZone: DAILY_LIMIT_TIME_ZONE,
        limitPoints: 100,
        usedPoints: 200,
        remainingPoints: 0,
        exceeded: true,
      })
    })
  })
})
