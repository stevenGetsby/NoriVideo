import { beforeEach, describe, expect, it, vi } from 'vitest'
import { processMediaResult } from '@/lib/media-process'

const storageMock = vi.hoisted(() => ({
  downloadAndUploadVideo: vi.fn(),
  generateUniqueKey: vi.fn((prefix: string, ext: string) => `images/${prefix}.${ext}`),
  toFetchableUrl: vi.fn((value: string) => value),
  uploadObject: vi.fn(async (_body: Buffer, key: string) => key),
}))

vi.mock('@/lib/storage', () => storageMock)

const pngBuffer = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')
const jpgBuffer = Buffer.from('ffd8ffe000104a4649460001', 'hex')

describe('processMediaResult', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses png extension and mime type for png data URLs', async () => {
    const key = await processMediaResult({
      source: `data:image/png;base64,${pngBuffer.toString('base64')}`,
      type: 'image',
      keyPrefix: 'panel',
      targetId: '1',
    })

    expect(key).toBe('images/panel-1.png')
    expect(storageMock.uploadObject).toHaveBeenCalledWith(
      expect.any(Buffer),
      'images/panel-1.png',
      undefined,
      'image/png',
    )
  })

  it('infers png extension from downloaded image bytes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(pngBuffer, {
      status: 200,
      headers: { 'content-type': 'image/jpeg' },
    })))

    const key = await processMediaResult({
      source: 'https://example.test/image',
      type: 'image',
      keyPrefix: 'panel',
      targetId: '2',
    })

    expect(key).toBe('images/panel-2.png')
    expect(storageMock.uploadObject).toHaveBeenCalledWith(
      expect.any(Buffer),
      'images/panel-2.png',
      undefined,
      'image/png',
    )
    vi.unstubAllGlobals()
  })

  it('uses jpeg extension and mime type for jpeg buffers', async () => {
    const key = await processMediaResult({
      source: jpgBuffer,
      type: 'image',
      keyPrefix: 'panel',
      targetId: '3',
    })

    expect(key).toBe('images/panel-3.jpg')
    expect(storageMock.uploadObject).toHaveBeenCalledWith(
      jpgBuffer,
      'images/panel-3.jpg',
      undefined,
      'image/jpeg',
    )
  })
})
