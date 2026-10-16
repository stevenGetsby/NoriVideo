import { afterEach, describe, expect, it, vi } from 'vitest'

const provider = vi.hoisted(() => ({
  kind: 'tos',
  toFetchableUrl: vi.fn((url: string) => url),
  uploadObject: vi.fn(async (input: { key: string }) => ({ key: input.key })),
}))
vi.mock('@/lib/storage/factory', () => ({ createStorageProvider: () => provider }))
vi.mock('@/lib/service-config', () => ({ getServiceConfigRevision: () => 'unit-test' }))
import { downloadAndUploadVideo } from '@/lib/storage'

afterEach(() => vi.unstubAllGlobals())
describe('generated video upload MIME', () => {
  it('uploads downloaded video bytes as video/mp4 even if the provider MIME is generic', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'binary/octet-stream' } })))
    expect(await downloadAndUploadVideo('https://upstream.test/result.mp4', 'images/video.mp4', 1)).toBe('images/video.mp4')
    expect(provider.uploadObject).toHaveBeenCalledWith({ key: 'images/video.mp4', body: expect.any(Buffer), contentType: 'video/mp4' })
  })
})
