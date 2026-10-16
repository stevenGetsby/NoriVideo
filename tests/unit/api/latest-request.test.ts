import { describe, expect, it } from 'vitest'
import { createLatestRequestTracker } from '@/lib/api/latest-request'

describe('account refresh request ordering', () => {
  it('rejects an older list response after a zero-limit mutation', () => {
    const requests = createLatestRequestTracker()
    const beforeSave = requests.begin()
    requests.invalidate()
    const afterSave = requests.begin()
    expect(requests.isCurrent(afterSave)).toBe(true)
    expect(requests.isCurrent(beforeSave)).toBe(false)
  })

  it('only applies the newest overlapping refresh', () => {
    const requests = createLatestRequestTracker()
    const first = requests.begin()
    const second = requests.begin()
    expect(requests.isCurrent(first)).toBe(false)
    expect(requests.isCurrent(second)).toBe(true)
    requests.invalidate()
    expect(requests.isCurrent(second)).toBe(false)
  })
})
