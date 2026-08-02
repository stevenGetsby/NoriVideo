import { describe, expect, it } from 'vitest'
import { settleWithConcurrency } from '@/lib/async/settle-with-concurrency'

describe('settleWithConcurrency', () => {
  it('processes every selected item without exceeding the upload ceiling', async () => {
    let active = 0
    let peak = 0
    const results = await settleWithConcurrency([0, 1, 2, 3, 4, 5], 2, async (value) => {
      active += 1
      peak = Math.max(peak, active)
      await Promise.resolve()
      active -= 1
      return `uploaded-${value}`
    })

    expect(peak).toBe(2)
    expect(results).toEqual([0, 1, 2, 3, 4, 5].map((value, index) => ({
      status: 'fulfilled',
      index,
      value: `uploaded-${value}`,
    })))
  })

  it('retains later successes and original indexes after one upload fails', async () => {
    const results = await settleWithConcurrency(['a', 'b', 'c'], 2, async (value) => {
      if (value === 'b') throw new Error('bad file')
      return value.toUpperCase()
    })

    expect(results[0]).toEqual({ status: 'fulfilled', index: 0, value: 'A' })
    expect(results[1]).toMatchObject({ status: 'rejected', index: 1 })
    expect(results[2]).toEqual({ status: 'fulfilled', index: 2, value: 'C' })
  })
})
