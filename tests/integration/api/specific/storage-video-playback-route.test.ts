import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../../helpers/request'

const storage = vi.hoisted(() => ({
  getSignedObjectUrl: vi.fn(),
  getObjectBuffer: vi.fn(),
  getStorageType: vi.fn<() => 'tos' | 'local'>(() => 'tos'),
}))
vi.mock('@/lib/storage', () => storage)
const thumbnail = vi.hoisted(() => ({ ensureCanvasThumbnail: vi.fn(), normalizeCanvasThumbnailWidth: vi.fn() }))
vi.mock('@/lib/media/thumbnail', () => thumbnail)
const poster = vi.hoisted(() => ({ ensureVideoPoster: vi.fn(), normalizeVideoPosterWidth: vi.fn(() => 480) }))
vi.mock('@/lib/media/video-poster', () => poster)
import { GET } from '@/app/api/storage/sign/route'

async function get(key = 'images/video.mp4', range?: string, playback = true) {
  return GET(buildMockRequest({
    path: '/api/storage/sign', method: 'GET',
    query: { key, ...(playback ? { playback: '1' } : {}) },
    headers: range ? { range } : {},
  }), { params: Promise.resolve({}) })
}

describe('range-capable canvas video playback', () => {
  beforeEach(() => { vi.clearAllMocks(); storage.getSignedObjectUrl.mockResolvedValue('https://storage.test/video.mp4') })
  afterEach(() => vi.unstubAllGlobals())

  it('streams a byte range with a playable MIME type and inline disposition', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), {
      status: 206,
      headers: { 'Content-Type': 'binary/octet-stream', 'Content-Disposition': 'attachment', 'Content-Length': '3', 'Content-Range': 'bytes 0-2/100' },
    }))
    vi.stubGlobal('fetch', fetchMock)
    const result = await get('images/video.mp4', 'bytes=0-2')
    expect(result.status).toBe(206)
    expect(result.headers.get('content-type')).toBe('video/mp4')
    expect(result.headers.get('content-disposition')).toBe('inline')
    expect(result.headers.get('content-range')).toBe('bytes 0-2/100')
    expect([...new Uint8Array(await result.arrayBuffer())]).toEqual([1, 2, 3])
    expect(fetchMock).toHaveBeenCalledWith('https://storage.test/video.mp4', expect.objectContaining({ headers: { Range: 'bytes=0-2' } }))
    expect(result.headers.get('cache-control')).toBe('private, max-age=86400')
    expect(storage.getObjectBuffer).not.toHaveBeenCalled()
  })

  it('retains upstream 416 range semantics and rejects malformed range requests', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */100' } })))
    const result = await get('video/clip.webm', 'bytes=1000-2000')
    expect(result.status).toBe(416)
    expect(result.headers.get('content-range')).toBe('bytes */100')
    expect((await get('video/clip.webm', 'bytes=0-1,20-30')).status).toBe(400)
    expect((await get('images/image.png')).status).toBe(400)
  })

  it('forwards conditional requests and preserves upstream 304 responses', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, {
      status: 304,
      headers: { ETag: '"video-v1"', 'Last-Modified': 'Sat, 15 Nov 2026 00:00:00 GMT' },
    }))
    vi.stubGlobal('fetch', fetchMock)
    const response = await GET(buildMockRequest({
      path: '/api/storage/sign', method: 'GET', query: { key: 'video/clip.mp4', playback: '1' },
      headers: {
        'if-none-match': '"video-v1"',
        'if-modified-since': 'Sat, 15 Nov 2026 00:00:00 GMT',
        'if-range': '"video-v1"',
      },
    }), { params: Promise.resolve({}) })
    expect(response.status).toBe(304)
    expect(response.headers.get('etag')).toBe('"video-v1"')
    expect(response.headers.get('last-modified')).toBe('Sat, 15 Nov 2026 00:00:00 GMT')
    expect(response.headers.get('cache-control')).toBe('private, max-age=86400')
    expect(fetchMock.mock.calls[0][1].headers).toEqual({
      'If-None-Match': '"video-v1"',
      'If-Modified-Since': 'Sat, 15 Nov 2026 00:00:00 GMT',
      'If-Range': '"video-v1"',
    })
  })

  it('keeps ordinary image signing as a redirect and sanitizes video upstream errors', async () => {
    const image = await get('images/image.png', undefined, false)
    expect(image.status).toBe(307)
    expect(storage.getSignedObjectUrl).toHaveBeenCalledWith('images/image.png', 3600, {
      signingBucketSeconds: 21600,
      responseCacheControl: 'private, max-age=86400',
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('private-upstream-diagnostic', { status: 403 })))
    const failed = await get()
    expect(failed.status).toBe(502)
    expect(await failed.text()).not.toContain('private-upstream-diagnostic')
  })
})

describe('signed image redirect caching', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    storage.getStorageType.mockReturnValue('tos')
    storage.getSignedObjectUrl.mockResolvedValue('https://storage.test/image.png?sig=1')
  })
  afterEach(() => vi.useRealTimers())

  const redirect = (query: Record<string, string>) => GET(buildMockRequest({
    path: '/api/storage/sign', method: 'GET', query: { key: 'images/image.png', ...query },
  }), { params: Promise.resolve({}) })

  it('lets the browser reuse one signed URL throughout its signing bucket', async () => {
    const result = await redirect({})
    expect(result.status).toBe(307)
    expect(result.headers.get('location')).toBe('https://storage.test/image.png?sig=1')
    expect(result.headers.get('cache-control')).toMatch(/^private, max-age=\d+$/)
    expect(storage.getSignedObjectUrl).toHaveBeenCalledWith('images/image.png', 3600, {
      signingBucketSeconds: 21600,
      responseCacheControl: 'private, max-age=86400',
    })
  })

  it('uses the remaining TOS signing bucket with a one-minute cache floor', async () => {
    vi.useFakeTimers()
    vi.setSystemTime('2026-11-15T11:59:59Z')
    expect((await redirect({})).headers.get('cache-control')).toBe('private, max-age=60')
    vi.setSystemTime('2026-11-15T06:00:00Z')
    expect((await redirect({})).headers.get('cache-control')).toBe('private, max-age=21600')
  })

  it('resolves a local signed path and caps caching to half its requested TTL', async () => {
    storage.getStorageType.mockReturnValue('local')
    storage.getSignedObjectUrl.mockResolvedValue('/api/files/images/image.png')
    const result = await redirect({ expires: '30' })
    expect(result.status).toBe(307)
    expect(result.headers.get('location')).toBe('http://localhost:3000/api/files/images/image.png')
    expect(result.headers.get('cache-control')).toBe('private, max-age=15')
  })

  it('returns a cached redirect to a generated thumbnail without proxying its bytes', async () => {
    thumbnail.normalizeCanvasThumbnailWidth.mockReturnValue(960)
    thumbnail.ensureCanvasThumbnail.mockResolvedValue('images/thumbnails/ab/cdef/w960.webp')

    const result = await redirect({ thumbnail: '960' })

    expect(thumbnail.normalizeCanvasThumbnailWidth).toHaveBeenCalledWith('960')
    expect(thumbnail.ensureCanvasThumbnail).toHaveBeenCalledWith('images/image.png', 960)
    expect(storage.getSignedObjectUrl).toHaveBeenCalledWith('images/thumbnails/ab/cdef/w960.webp', 3600, {
      signingBucketSeconds: 21600,
      responseCacheControl: 'private, max-age=86400',
    })
    expect(result.status).toBe(307)
    expect(result.headers.get('cache-control')).toMatch(/^private, max-age=\d+$/)
  })

  it('serves and caches a generated video poster, with a bounded 404 on failure', async () => {
    poster.ensureVideoPoster.mockResolvedValue('images/posters/ab/cdef/w480.webp')
    const result = await GET(buildMockRequest({
      path: '/api/storage/sign', method: 'GET', query: { key: 'video/clip.mp4', poster: '480' },
    }), { params: Promise.resolve({}) })
    expect(result.status).toBe(307)
    expect(storage.getSignedObjectUrl).toHaveBeenCalledWith('images/posters/ab/cdef/w480.webp', 3600, {
      signingBucketSeconds: 21600,
      responseCacheControl: 'private, max-age=86400',
    })
    poster.ensureVideoPoster.mockRejectedValue(new Error('no frame'))
    const failed = await GET(buildMockRequest({
      path: '/api/storage/sign', method: 'GET', query: { key: 'video/clip.mp4', poster: '480' },
    }), { params: Promise.resolve({}) })
    expect(failed.status).toBe(404)
    expect(failed.headers.get('cache-control')).toBe('private, max-age=600')
  })

  it('rejects animated thumbnails and conflicting media modes', async () => {
    expect((await redirect({ thumbnail: '480', inline: '1' })).status).toBe(400)
    expect((await GET(buildMockRequest({
      path: '/api/storage/sign', method: 'GET', query: { key: 'images/motion.gif', thumbnail: '480' },
    }), { params: Promise.resolve({}) })).status).toBe(400)
    expect(thumbnail.ensureCanvasThumbnail).not.toHaveBeenCalled()
  })
})
