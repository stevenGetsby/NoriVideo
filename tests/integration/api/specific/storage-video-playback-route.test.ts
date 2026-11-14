import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../../helpers/request'

const storage = vi.hoisted(() => ({ getSignedObjectUrl: vi.fn(), getObjectBuffer: vi.fn() }))
vi.mock('@/lib/storage', () => storage)
const thumbnail = vi.hoisted(() => ({ ensureCanvasThumbnail: vi.fn(), normalizeCanvasThumbnailWidth: vi.fn() }))
vi.mock('@/lib/media/thumbnail', () => thumbnail)
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

  it('keeps ordinary image signing as a redirect and sanitizes video upstream errors', async () => {
    const image = await get('images/image.png', undefined, false)
    expect(image.status).toBe(307)
    expect(storage.getSignedObjectUrl).toHaveBeenCalledWith('images/image.png', 3600)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('private-upstream-diagnostic', { status: 403 })))
    const failed = await get()
    expect(failed.status).toBe(502)
    expect(await failed.text()).not.toContain('private-upstream-diagnostic')
  })
})

describe('signed image redirect caching', () => {
  beforeEach(() => { vi.clearAllMocks(); storage.getSignedObjectUrl.mockResolvedValue('https://storage.test/image.png?sig=1') })

  const redirect = (query: Record<string, string>) => GET(buildMockRequest({
    path: '/api/storage/sign', method: 'GET', query: { key: 'images/image.png', ...query },
  }), { params: Promise.resolve({}) })

  it('lets the browser reuse one signed URL for a bounded time instead of re-signing every remount', async () => {
    const result = await redirect({})
    expect(result.status).toBe(307)
    expect(result.headers.get('location')).toBe('https://storage.test/image.png?sig=1')
    expect(result.headers.get('cache-control')).toBe('private, max-age=600')
  })

  it('never caches a redirect for longer than half of the signature lifetime', async () => {
    expect((await redirect({ expires: '300' })).headers.get('cache-control')).toBe('private, max-age=150')
    expect((await redirect({ expires: '1' })).headers.get('cache-control')).toBe('private, max-age=0')
    expect((await redirect({ expires: '86400' })).headers.get('cache-control')).toBe('private, max-age=600')
  })

  it('returns a cached redirect to a generated thumbnail without proxying its bytes', async () => {
    thumbnail.normalizeCanvasThumbnailWidth.mockReturnValue(960)
    thumbnail.ensureCanvasThumbnail.mockResolvedValue('images/thumbnails/ab/cdef/w960.webp')

    const result = await redirect({ thumbnail: '960' })

    expect(thumbnail.normalizeCanvasThumbnailWidth).toHaveBeenCalledWith('960')
    expect(thumbnail.ensureCanvasThumbnail).toHaveBeenCalledWith('images/image.png', 960)
    expect(storage.getSignedObjectUrl).toHaveBeenCalledWith('images/thumbnails/ab/cdef/w960.webp', 3600)
    expect(result.status).toBe(307)
    expect(result.headers.get('cache-control')).toBe('private, max-age=600')
  })

  it('rejects animated thumbnails and conflicting media modes', async () => {
    expect((await redirect({ thumbnail: '480', inline: '1' })).status).toBe(400)
    expect((await GET(buildMockRequest({
      path: '/api/storage/sign', method: 'GET', query: { key: 'images/motion.gif', thumbnail: '480' },
    }), { params: Promise.resolve({}) })).status).toBe(400)
    expect(thumbnail.ensureCanvasThumbnail).not.toHaveBeenCalled()
  })
})
