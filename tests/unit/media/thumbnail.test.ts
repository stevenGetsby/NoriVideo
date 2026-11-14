import sharp from 'sharp'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const storage = vi.hoisted(() => ({
  getObjectBuffer: vi.fn(),
  uploadObject: vi.fn(),
}))
vi.mock('@/lib/storage', () => storage)

import {
  canvasThumbnailKey,
  ensureCanvasThumbnail,
  normalizeCanvasThumbnailWidth,
} from '@/lib/media/thumbnail'

describe('canvas image thumbnails', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    storage.uploadObject.mockImplementation(async (_body, key) => key)
  })

  it('creates a persistent, smaller WebP instead of serving the original pixels', async () => {
    const source = await sharp({
      create: { width: 2400, height: 1200, channels: 4, background: { r: 35, g: 81, b: 125, alpha: 1 } },
    }).png().toBuffer()
    storage.getObjectBuffer.mockImplementation(async (key: string) => {
      if (key === 'images/original.png') return source
      throw new Error('not found')
    })

    const key = await ensureCanvasThumbnail('images/original.png', 480)
    expect(key).toBe(canvasThumbnailKey('images/original.png', 480))
    expect(key).toMatch(/^images\/thumbnails\/[a-f0-9]{2}\/[a-f0-9]{62}\/w480\.webp$/)
    const [body, , width, mime] = storage.uploadObject.mock.calls[0]
    const metadata = await sharp(body).metadata()
    expect(metadata.width).toBe(480)
    expect(metadata.height).toBe(240)
    expect(metadata.format).toBe('webp')
    expect(width).toBe(1)
    expect(mime).toBe('image/webp')
  })

  it('reuses a persistent derivative and coalesces concurrent work', async () => {
    const key = canvasThumbnailKey('images/cached.png', 960)
    storage.getObjectBuffer.mockResolvedValue(Buffer.from('existing derivative'))
    expect(await ensureCanvasThumbnail('images/cached.png', 960)).toBe(key)
    expect(storage.uploadObject).not.toHaveBeenCalled()

    const source = await sharp({ create: { width: 2400, height: 1200, channels: 3, background: '#36517d' } }).png().toBuffer()
    storage.getObjectBuffer.mockImplementation(async (key: string) => {
      if (key === 'images/pending.png') return source
      throw new Error('missing')
    })
    let finish: ((key: string) => void) | undefined
    const pending = new Promise<string>((resolve) => { finish = resolve })
    storage.uploadObject.mockReturnValueOnce(pending)
    const original = ensureCanvasThumbnail('images/pending.png', 480)
    const duplicate = ensureCanvasThumbnail('images/pending.png', 480)
    await vi.waitFor(() => expect(storage.uploadObject).toHaveBeenCalledTimes(1))
    expect(storage.getObjectBuffer.mock.calls.map(([requestedKey]) => requestedKey)).toEqual([
      canvasThumbnailKey('images/cached.png', 960),
      canvasThumbnailKey('images/pending.png', 480),
      'images/pending.png',
    ])
    finish?.('images/thumbnails/small.webp')
    expect(await original).toBe('images/thumbnails/small.webp')
    await expect(duplicate).resolves.toBe('images/thumbnails/small.webp')
    expect(storage.uploadObject).toHaveBeenCalledWith(expect.any(Buffer), expect.stringContaining('w480.webp'), 1, 'image/webp')
  })

  it('keeps small originals and rejects unsupported width values', async () => {
    const source = await sharp({ create: { width: 320, height: 180, channels: 3, background: '#36517d' } }).png().toBuffer()
    storage.getObjectBuffer.mockImplementation(async (key: string) => {
      if (key === 'images/small-original.png') return source
      throw new Error('not found')
    })
    expect(await ensureCanvasThumbnail('images/small-original.png', 480)).toBe('images/small-original.png')
    expect(storage.uploadObject).not.toHaveBeenCalled()
    expect(normalizeCanvasThumbnailWidth('1440')).toBe(1440)
    expect(() => normalizeCanvasThumbnailWidth('481')).toThrow()
  })
})
