import { beforeEach, describe, expect, it, vi } from 'vitest'

const ledgerMock = vi.hoisted(() => ({
  getBalance: vi.fn(),
}))
const dailyLimitMock = vi.hoisted(() => ({
  assertDailyLimit: vi.fn(),
}))

vi.mock('@/lib/billing/ledger', () => ledgerMock)
vi.mock('@/lib/billing/daily-limit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/billing/daily-limit')>()),
  assertDailyLimit: dailyLimitMock.assertDailyLimit,
}))

import { requireGenerationCredit } from '@/lib/billing/generation-gate'
import { DailyLimitExceededError } from '@/lib/billing/errors'

function dailyLimitError(overrides?: { limitPoints?: number; usedPoints?: number; requestedPoints?: number }) {
  return new DailyLimitExceededError({
    limitPoints: overrides?.limitPoints ?? 1000,
    usedPoints: overrides?.usedPoints ?? 1000,
    requestedPoints: overrides?.requestedPoints ?? 0,
    windowEnd: '2026-09-17T16:00:00.000Z',
  })
}

describe('billing/generation-gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ledgerMock.getBalance.mockResolvedValue({ balance: 10 })
    dailyLimitMock.assertDailyLimit.mockResolvedValue({ limitPoints: null })
  })

  it('余额充足且未超每日额度时放行', async () => {
    await expect(requireGenerationCredit('u1')).resolves.toMatchObject({ balance: 10 })
    expect(dailyLimitMock.assertDailyLimit).toHaveBeenCalledWith('u1')
  })

  it('余额为 0 时仍先报余额不足', async () => {
    ledgerMock.getBalance.mockResolvedValue({ balance: 0 })

    await expect(requireGenerationCredit('u1')).rejects.toMatchObject({
      code: 'INSUFFICIENT_BALANCE',
    })
    expect(dailyLimitMock.assertDailyLimit).not.toHaveBeenCalled()
  })

  it('余额充足但今日额度用尽时报 DAILY_LIMIT_EXCEEDED', async () => {
    dailyLimitMock.assertDailyLimit.mockRejectedValue(dailyLimitError())

    const error = await requireGenerationCredit('u1').catch((caught: unknown) => caught)
    expect(error).toMatchObject({
      code: 'DAILY_LIMIT_EXCEEDED',
      status: 402,
      details: {
        limitPoints: 1000,
        usedPoints: 1000,
        requestedPoints: 0,
        resetsAt: '2026-09-17T16:00:00.000Z',
      },
    })
    expect((error as Error).message).toContain('今日用量已达上限')
  })

  it('每日额度检查抛出非预期错误时原样透传', async () => {
    const unexpected = new Error('db down')
    dailyLimitMock.assertDailyLimit.mockRejectedValue(unexpected)

    await expect(requireGenerationCredit('u1')).rejects.toBe(unexpected)
  })
})
