import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const getMediaObjectByPublicIdMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/media/service', () => ({ getMediaObjectByPublicId: getMediaObjectByPublicIdMock }))

const storageMocks = vi.hoisted(() => ({
  getSignedObjectUrl: vi.fn(),
  getSignedUrl: vi.fn(() => '/api/storage/sign?key=images%2Fa.png'),
  toFetchableUrl: vi.fn((url: string) => url),
}))
vi.mock('@/lib/storage', () => storageMocks)

import { GET } from '@/app/m/[publicId]/route'

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

const media = {
  id: 'media-1',
  publicId: 'abc',
  storageKey: 'images/a.png',
  sha256: 'hash-1',
  mimeType: 'video/mp4',
  sizeBytes: 5,
  updatedAt: null,
}

function get(url: string, headers?: Record<string, string>) {
  return GET(new NextRequest(url, { headers }), { params: Promise.resolve({ publicId: 'abc' }) })
}

describe('public media route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.PUBLIC_MEDIA_REDIRECT
    getMediaObjectByPublicIdMock.mockResolvedValue(media)
    storageMocks.getSignedObjectUrl.mockResolvedValue('https://tos.example/signed')
    storageMocks.getSignedUrl.mockReturnValue('/api/storage/sign?key=images%2Fa.png')
    storageMocks.toFetchableUrl.mockImplementation((url: string) => url)
    fetchMock.mockResolvedValue(new Response('bytes', { status: 200, headers: { 'content-type': 'video/mp4', 'content-length': '5' } }))
  })

  afterEach(() => {
    delete process.env.PUBLIC_MEDIA_REDIRECT
  })

  it('redirects plain playback to a bucketed signed direct link', async () => {
    const response = await get('https://lanmiaoai.com/m/abc')
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('https://tos.example/signed')
    expect(response.headers.get('cache-control')).toBe('public, max-age=300')
    expect(storageMocks.getSignedObjectUrl).toHaveBeenCalledWith('images/a.png', 3600, {
      signingBucketSeconds: 3600,
      responseCacheControl: 'private, max-age=86400',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('keeps the same-origin proxy for ?proxy=1 byte consumers', async () => {
    const response = await get('https://lanmiaoai.com/m/abc?proxy=1')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('video/mp4')
    expect(storageMocks.getSignedObjectUrl).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('forces the proxy when PUBLIC_MEDIA_REDIRECT=0', async () => {
    process.env.PUBLIC_MEDIA_REDIRECT = '0'
    const response = await get('https://lanmiaoai.com/m/abc')
    expect(response.status).toBe(200)
    expect(storageMocks.getSignedObjectUrl).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('short-circuits to 304 on a matching ETag before redirecting', async () => {
    const response = await get('https://lanmiaoai.com/m/abc', { 'if-none-match': '"hash-1"' })
    expect(response.status).toBe(304)
    expect(storageMocks.getSignedObjectUrl).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns 404 for unknown media', async () => {
    getMediaObjectByPublicIdMock.mockResolvedValue(null)
    const response = await get('https://lanmiaoai.com/m/missing')
    expect(response.status).toBe(404)
  })
})
