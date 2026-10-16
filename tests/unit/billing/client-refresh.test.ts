import { afterEach, describe, expect, it, vi } from 'vitest'
import { notifyBalanceChanged, subscribeBalanceChanges } from '@/lib/billing/client'

class Channel {
  static instances: Channel[] = []
  onmessage?: (event: { data: unknown }) => void
  close = vi.fn()
  constructor() { Channel.instances.push(this) }
  postMessage(data: unknown) {
    for (const other of Channel.instances) if (other !== this) other.onmessage?.({ data })
  }
}

afterEach(() => { vi.unstubAllGlobals(); Channel.instances = [] })
describe('billing/limit refresh notifications', () => {
  it('refreshes this tab once, listens to other tabs, and cleans up subscriptions', () => {
    vi.stubGlobal('window', new EventTarget())
    vi.stubGlobal('BroadcastChannel', Channel)
    const refresh = vi.fn()
    const cleanup = subscribeBalanceChanges(refresh)
    notifyBalanceChanged()
    expect(refresh).toHaveBeenCalledTimes(1)
    Channel.instances[0].onmessage?.({ data: { type: 'refresh', source: 'another-tab' } })
    expect(refresh).toHaveBeenCalledTimes(2)
    cleanup()
    expect(Channel.instances[0].close).toHaveBeenCalledTimes(1)
    notifyBalanceChanged()
    // The fake no longer receives local events after cleanup.
    expect(refresh).toHaveBeenCalledTimes(2)
  })
})
