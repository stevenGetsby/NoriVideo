import { describe, expect, it } from 'vitest'
import { updateDailyUsageLimit } from '@/lib/billing/daily-limit-display'
import type { DailyUsagePayload } from '@/lib/billing/daily-limit'

const used: DailyUsagePayload = {
  timeZone: 'Asia/Shanghai', limitPoints: 100, usedPoints: 110, consumedPoints: 80, pendingPoints: 30,
  remainingPoints: 0, exceeded: true, resetsAt: '2026-10-08T16:00:00.000Z',
}

describe('daily limit display update', () => {
  it('unlimited clears the exceeded status but 0 blocks, without resetting usage', () => {
      expect(updateDailyUsageLimit(used, null)).toEqual({
        ...used, limitPoints: null, remainingPoints: null, exceeded: false,
      })
      expect(updateDailyUsageLimit(used, 0)).toEqual({
        ...used, limitPoints: 0, remainingPoints: 0, exceeded: true,
      })
    expect(used.exceeded).toBe(true)
  })

  it('recomputes remaining allowance when the admin increases or reduces the limit', () => {
    expect(updateDailyUsageLimit(used, 300)).toMatchObject({ usedPoints: 110, remainingPoints: 190, exceeded: false })
    expect(updateDailyUsageLimit(used, 90)).toMatchObject({ usedPoints: 110, remainingPoints: 0, exceeded: true })
    expect(updateDailyUsageLimit(null, 0)).toBeNull()
  })
})
