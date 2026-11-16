import { createHash } from 'crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const storageMock = vi.hoisted(() => ({ getSignedObjectUrl: vi.fn() }))
vi.mock('@/lib/storage', () => storageMock)

import { MP_URL_BUCKET_SEC, MP_URL_TTL_SEC, cdnConfigured, mpMediaUrl, mpUrlExpiresAt, signCdnPath } from '@/lib/storage/cdn'

const NOW = 1_800_000_000
const ENV_KEYS = ['MEDIA_CDN_BASE_URL', 'MEDIA_CDN_AUTH_KEY', 'MEDIA_CDN_AUTH_PARAM', 'MP_ALLOW_TOS_DIRECT'] as const
let saved: Record<string, string | undefined> = {}

function configureCdn(base = 'https://media.example.com', key = 'test-auth-key') {
  process.env.MEDIA_CDN_BASE_URL = base
  process.env.MEDIA_CDN_AUTH_KEY = key
}

beforeEach(() => {
  vi.clearAllMocks()
  saved = {}
  for (const name of ENV_KEYS) {
    saved[name] = process.env[name]
    delete process.env[name]
  }
  storageMock.getSignedObjectUrl.mockResolvedValue('https://tos.example/signed')
})

afterEach(() => {
  for (const name of ENV_KEYS) {
    if (saved[name] === undefined) delete process.env[name]
    else process.env[name] = saved[name]
  }
})

describe('cdnConfigured', () => {
  it('requires both base url and auth key', () => {
    expect(cdnConfigured()).toBe(false)
    process.env.MEDIA_CDN_BASE_URL = 'https://media.example.com'
    expect(cdnConfigured()).toBe(false)
    configureCdn()
    expect(cdnConfigured()).toBe(true)
  })
})

describe('signCdnPath', () => {
  it('produces the A-type auth_key URL with a 6 hour bucket', () => {
    configureCdn()
    const path = '/mp/releases/r1/m/abc/720.mp4'
    const ts = Math.floor(NOW / MP_URL_BUCKET_SEC) * MP_URL_BUCKET_SEC
    const hash = createHash('md5').update(`${path}-${ts}-0-0-test-auth-key`).digest('hex')
    expect(signCdnPath(path, NOW)).toBe(`https://media.example.com${path}?auth_key=${ts}-0-0-${hash}`)
  })

  it('honors a custom auth param and trims trailing slashes from the base', () => {
    configureCdn('https://media.example.com/', 'k')
    process.env.MEDIA_CDN_AUTH_PARAM = 'sign'
    const url = signCdnPath('/a.jpg', NOW)
    expect(url.startsWith('https://media.example.com/a.jpg?sign=')).toBe(true)
  })

  it('keeps URLs identical inside one bucket so the CDN cache can hit', () => {
    configureCdn()
    const bucketStart = Math.floor(NOW / MP_URL_BUCKET_SEC) * MP_URL_BUCKET_SEC
    expect(signCdnPath('/a.jpg', bucketStart)).toBe(signCdnPath('/a.jpg', bucketStart + MP_URL_BUCKET_SEC - 1))
    expect(signCdnPath('/a.jpg', bucketStart)).not.toBe(signCdnPath('/a.jpg', bucketStart + MP_URL_BUCKET_SEC))
  })
})

describe('mpMediaUrl', () => {
  it('signs CDN URLs per path segment without touching storage', async () => {
    configureCdn()
    const url = await mpMediaUrl('mp/releases/r1/m/a b/720.mp4', NOW)
    expect(url.startsWith('https://media.example.com/mp/releases/r1/m/a%20b/720.mp4?auth_key=')).toBe(true)
    expect(storageMock.getSignedObjectUrl).not.toHaveBeenCalled()
  })

  it('falls back to a 12 hour TOS direct link only when MP_ALLOW_TOS_DIRECT=1', async () => {
    process.env.MP_ALLOW_TOS_DIRECT = '1'
    const url = await mpMediaUrl('mp/releases/r1/cover.jpg', NOW)
    expect(url).toBe('https://tos.example/signed')
    expect(storageMock.getSignedObjectUrl).toHaveBeenCalledWith('mp/releases/r1/cover.jpg', MP_URL_TTL_SEC)
  })

  it('throws 503 MP_CDN_NOT_CONFIGURED when neither CDN nor TOS direct is available', async () => {
    await expect(mpMediaUrl('mp/releases/r1/cover.jpg', NOW)).rejects.toMatchObject({ code: 'MP_CDN_NOT_CONFIGURED', status: 503 })
    expect(storageMock.getSignedObjectUrl).not.toHaveBeenCalled()
  })
})

describe('mpUrlExpiresAt', () => {
  it('returns bucket start plus 12 hours as ISO', () => {
    const bucketStart = Math.floor(NOW / MP_URL_BUCKET_SEC) * MP_URL_BUCKET_SEC
    expect(mpUrlExpiresAt(NOW)).toBe(new Date((bucketStart + MP_URL_TTL_SEC) * 1000).toISOString())
    expect(mpUrlExpiresAt(bucketStart)).toBe(new Date((bucketStart + MP_URL_TTL_SEC) * 1000).toISOString())
  })
})
