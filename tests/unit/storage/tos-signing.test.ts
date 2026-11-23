import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TosStorageProvider } from '@/lib/storage/providers/tos'

const config = vi.hoisted(() => ({
  getServiceStorageConfig: vi.fn(() => ({
    tos: {
      endpoint: 'tos.example.com',
      region: 'cn-beijing',
      bucket: 'media',
      accessKey: 'test-access-key',
      secretKey: 'test-secret-key',
    },
  })),
}))
vi.mock('@/lib/service-config', () => config)

describe('TOS bucketed object URL signing', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime('2026-11-15T07:30:00Z')
  })
  afterEach(() => vi.useRealTimers())

  it('reuses a signature inside a bucket and extends its expiry across the bucket boundary', async () => {
    const provider = new TosStorageProvider()
    const input = { key: 'images/a.png', expiresInSeconds: 3600, signingBucketSeconds: 21600 }
    const first = new URL(await provider.getSignedObjectUrl(input))
    vi.advanceTimersByTime(1000)
    expect(await provider.getSignedObjectUrl(input)).toBe(first.toString())
    expect(first.searchParams.get('X-Tos-Date')).toBe('20261115T060000Z')
    expect(first.searchParams.get('X-Tos-Expires')).toBe('25200')
    vi.setSystemTime('2026-11-15T12:00:00Z')
    const next = new URL(await provider.getSignedObjectUrl(input))
    expect(next.searchParams.get('X-Tos-Signature')).not.toBe(first.searchParams.get('X-Tos-Signature'))
    expect(next.searchParams.get('X-Tos-Date')).toBe('20261115T120000Z')
  })

  it('includes the response cache policy in the signed query', async () => {
    const provider = new TosStorageProvider()
    const input = { key: 'images/a.png', expiresInSeconds: 3600 }
    const first = new URL(await provider.getSignedObjectUrl(input))
    const second = new URL(await provider.getSignedObjectUrl({ ...input, responseCacheControl: 'private, max-age=86400' }))
    expect(second.searchParams.get('response-cache-control')).toBe('private, max-age=86400')
    expect(second.searchParams.get('X-Tos-Signature')).not.toBe(first.searchParams.get('X-Tos-Signature'))
  })
})
