import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'

const storage = vi.hoisted(() => ({
  getSignedObjectUrl: vi.fn(async (key: string) => `https://storage.test/${key}`),
  uploadObject: vi.fn(async (_body: Buffer, key: string) => key),
}))
vi.mock('@/lib/storage', () => storage)
vi.mock('@/lib/api-config', () => ({
  getProviderConfig: vi.fn(async () => ({ apiKey: 'unit-test-only', baseUrl: 'https://provider.test' })),
}))
vi.mock('@/lib/media/seedance-reference', () => ({
  normalizeSeedanceImageReference: vi.fn(async (url: string) => url),
  normalizeSeedanceImageReferences: vi.fn(async (urls: string[]) => urls),
  normalizeSeedanceMediaReference: vi.fn(async (url: string) => url),
}))
import { generateKuaiziVideo } from '@/lib/providers/kuaizi/video'

describe('Kuaizi final Seedance submission image boundary', () => {
  const submissions: Array<Record<string, unknown>> = []
  let large: Buffer
  let valid: Buffer
  beforeEach(async () => {
    vi.clearAllMocks()
    submissions.length = 0
    large = await sharp({ create: { width: 6336, height: 2688, channels: 3, background: '#456789' } }).jpeg().toBuffer()
    valid = await sharp({ create: { width: 512, height: 512, channels: 3, background: '#987654' } }).jpeg().toBuffer()
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url === 'https://inputs.test/large.jpg') return new Response(new Uint8Array(large))
      if (url === 'https://inputs.test/valid.jpg') return new Response(new Uint8Array(valid))
      if (url === 'https://inputs.test/missing.jpg') return new Response('', { status: 404 })
      if (url.startsWith('https://provider.test/')) {
        submissions.push(JSON.parse(String(init?.body)))
        return new Response(JSON.stringify({ id: 'test-task-not-real' }))
      }
      throw new Error('Unexpected test request')
    }))
  })
  afterEach(() => vi.unstubAllGlobals())

  it.each(['doubao-seedance-2-0-260128', 'doubao-seedance-2-0-fast-260128', 'doubao-seedance-2-0-mini-260615', 'doubao-seedance-2-5-260628'])(
    'prepares oversized images for %s and preserves reference order', async (modelId) => {
      await generateKuaiziVideo({
        userId: 'test-user', imageUrl: '', prompt: 'test',
        options: { provider: 'kuaizi', modelId, modelKey: `kuaizi::${modelId}`, referenceImages: ['https://inputs.test/large.jpg', 'https://inputs.test/valid.jpg'] },
      })
      expect(submissions).toHaveLength(1)
      const content = submissions[0].content as Array<{ type: string; image_url?: { url: string }; role?: string }>
      expect(content[1]).toMatchObject({ role: 'reference_image', image_url: { url: expect.stringMatching(/^https:\/\/storage.test\/images\/seedance-reference\//) } })
      expect(content[2]).toMatchObject({ role: 'reference_image', image_url: { url: 'https://inputs.test/valid.jpg' } })
      expect(await sharp(storage.uploadObject.mock.calls[0][0]).metadata()).toMatchObject({ width: 6000, height: 2545 })
    },
  )

  it('prepares first and last frames without losing their roles', async () => {
    await generateKuaiziVideo({
      userId: 'test-user', imageUrl: 'https://inputs.test/large.jpg', prompt: 'test',
      options: { provider: 'kuaizi', modelId: 'doubao-seedance-2-5-260628', modelKey: 'kuaizi::doubao-seedance-2-5-260628', lastFrameImageUrl: 'https://inputs.test/valid.jpg' },
    })
    const content = submissions[0].content as Array<{ role?: string }>
    expect(content.slice(1).map((entry) => entry.role)).toEqual(['first_frame', 'last_frame'])
    expect(storage.uploadObject).toHaveBeenCalledTimes(1)
  })

  it('does not submit a paid task when any reference is unavailable', async () => {
    await expect(generateKuaiziVideo({
      userId: 'test-user', imageUrl: '', prompt: 'test',
      options: { provider: 'kuaizi', modelId: 'doubao-seedance-2-5-260628', modelKey: 'kuaizi::doubao-seedance-2-5-260628', referenceImages: ['https://inputs.test/valid.jpg', 'https://inputs.test/missing.jpg'] },
    })).rejects.toThrow('参考图片读取失败')
    expect(submissions).toHaveLength(0)
  })

  it('submits text-only tasks without image fetches or uploads', async () => {
    await generateKuaiziVideo({
      userId: 'test-user', imageUrl: '', prompt: 'text-only',
      options: { provider: 'kuaizi', modelId: 'doubao-seedance-2-5-260628', modelKey: 'kuaizi::doubao-seedance-2-5-260628' },
    })
    expect(submissions).toHaveLength(1)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(storage.uploadObject).not.toHaveBeenCalled()
  })
})
