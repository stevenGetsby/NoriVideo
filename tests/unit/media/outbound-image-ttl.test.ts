import { beforeEach, describe, expect, it, vi } from 'vitest'

const storageMock = vi.hoisted(() => ({
  generateUniqueKey: vi.fn(() => 'outbound-reference/fixed.png'),
  getSignedObjectUrl: vi.fn(async (key: string, ttl: number) => `https://tos.example/${key}?ttl=${ttl}`),
  toFetchableUrl: vi.fn((value: string) => value),
  uploadObject: vi.fn(async (_buffer: Buffer, key: string) => key),
}))
const resolveMediaKeyMock = vi.hoisted(() => vi.fn(async () => null))

vi.mock('@/lib/storage', () => storageMock)
vi.mock('@/lib/media/service', () => ({ resolveStorageKeyFromMediaValue: resolveMediaKeyMock }))

import {
  normalizeReferenceImagesForGeneration,
  normalizeToOriginalMediaUrl,
  normalizeToPublicImageUrlForGeneration,
} from '@/lib/media/outbound-image'

describe('outbound media signed-url ttl', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    storageMock.getSignedObjectUrl.mockImplementation(async (key: string, ttl: number) => `https://tos.example/${key}?ttl=${ttl}`)
    storageMock.uploadObject.mockImplementation(async (_buffer: Buffer, key: string) => key)
    resolveMediaKeyMock.mockResolvedValue(null)
  })

  it('keeps the default 1h signature for existing callers', async () => {
    const url = await normalizeToOriginalMediaUrl('images/character.png')
    expect(storageMock.getSignedObjectUrl).toHaveBeenCalledWith('images/character.png', 3600)
    expect(url).toBe('https://tos.example/images/character.png?ttl=3600')
  })

  it('threads an explicit ttl through storage-key signing', async () => {
    await normalizeToOriginalMediaUrl('images/character.png', { ttlSeconds: 21600 })
    expect(storageMock.getSignedObjectUrl).toHaveBeenCalledWith('images/character.png', 21600)

    await normalizeToOriginalMediaUrl('/api/storage/sign?key=video%2Fclip.mp4', { ttlSeconds: 21600 })
    expect(storageMock.getSignedObjectUrl).toHaveBeenCalledWith('video/clip.mp4', 21600)
  })

  it('threads the ttl through reference normalization', async () => {
    const urls = await normalizeReferenceImagesForGeneration(
      ['images/a.png', 'images/b.png'],
      { context: { provider: 'tgg' }, ttlSeconds: 21600 },
    )
    expect(urls).toEqual([
      'https://tos.example/images/a.png?ttl=21600',
      'https://tos.example/images/b.png?ttl=21600',
    ])
    expect(storageMock.getSignedObjectUrl).toHaveBeenNthCalledWith(1, 'images/a.png', 21600)
    expect(storageMock.getSignedObjectUrl).toHaveBeenNthCalledWith(2, 'images/b.png', 21600)
  })

  it('signs re-uploaded data urls with the requested ttl', async () => {
    const png = Buffer.from('fake-png-bytes').toString('base64')
    const url = await normalizeToPublicImageUrlForGeneration(`data:image/png;base64,${png}`, { ttlSeconds: 21600 })
    expect(storageMock.uploadObject).toHaveBeenCalled()
    expect(storageMock.getSignedObjectUrl).toHaveBeenCalledWith('outbound-reference/fixed.png', 21600)
    expect(url).toBe('https://tos.example/outbound-reference/fixed.png?ttl=21600')
  })

  it('passes public https urls through untouched', async () => {
    const url = await normalizeToPublicImageUrlForGeneration('https://cdn.example/a.png', { ttlSeconds: 21600 })
    expect(url).toBe('https://cdn.example/a.png')
    expect(storageMock.getSignedObjectUrl).not.toHaveBeenCalled()
  })
})
