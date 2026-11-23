import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPreviewLoader, MAX_IN_FLIGHT_PREVIEWS } from '@/features/canvas/preview-loader'

afterEach(() => vi.useRealTimers())

describe('preview loader', () => {
  it('never lets more than the budget load at once and drains the queue in order', () => {
    const loader = createPreviewLoader()
    const granted: number[] = []
    const releases = Array.from({ length: 20 }, (_, index) => loader.request(() => granted.push(index)))
    expect(MAX_IN_FLIGHT_PREVIEWS).toBe(8)
    expect(loader.inFlight()).toBe(8)
    expect(loader.queued()).toBe(12)
    expect(granted).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    releases[0]()
    expect(granted.at(-1)).toBe(8)
    expect(loader.inFlight()).toBe(8)
    releases[1]()
    releases[2]()
    expect(granted.slice(8)).toEqual([8, 9, 10])
  })

  it('ignores double release and frees nothing for a request that was never granted', () => {
    const loader = createPreviewLoader(1)
    const granted: string[] = []
    const first = loader.request(() => granted.push('a'))
    const second = loader.request(() => granted.push('b'))
    second()
    second()
    expect(loader.inFlight()).toBe(1)
    expect(loader.queued()).toBe(0)
    first()
    first()
    expect(loader.inFlight()).toBe(0)
    expect(granted).toEqual(['a'])
  })

  it('skips cancelled waiters when a slot opens', () => {
    const loader = createPreviewLoader(1)
    const granted: string[] = []
    const first = loader.request(() => granted.push('a'))
    const cancelled = loader.request(() => granted.push('b'))
    loader.request(() => granted.push('c'))
    cancelled()
    first()
    expect(granted).toEqual(['a', 'c'])
  })

  it('releases a stalled slot so the queue cannot deadlock', () => {
    vi.useFakeTimers()
    const loader = createPreviewLoader(1, 1000)
    const granted: string[] = []
    loader.request(() => granted.push('a'))
    loader.request(() => granted.push('b'))
    expect(granted).toEqual(['a'])
    vi.advanceTimersByTime(1000)
    expect(granted).toEqual(['a', 'b'])
    expect(loader.inFlight()).toBe(1)
  })
})
