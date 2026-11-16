import { beforeEach, describe, expect, it, vi } from 'vitest'

const getProviderConfigMock = vi.hoisted(() => vi.fn())
const normalizeReferencesMock = vi.hoisted(() => vi.fn())
const normalizeMediaMock = vi.hoisted(() => vi.fn())
const definitionMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api-config', () => ({ getProviderConfig: getProviderConfigMock }))
vi.mock('@/lib/media/outbound-image', () => ({
  normalizeReferenceImagesForGeneration: normalizeReferencesMock,
  normalizeToOriginalMediaUrl: normalizeMediaMock,
}))
vi.mock('@/lib/providers/tgg/catalog', () => ({ getTggModelDefinition: definitionMock }))

import { generateTggVideo } from '@/lib/providers/tgg/video'
import type { TggModelDefinition } from '@/lib/providers/tgg/types'

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function definition(overrides: Partial<TggModelDefinition> = {}): TggModelDefinition {
  return {
    modelId: 'tgg-fixture-video',
    name: 'tgg-fixture-video',
    modality: 'video',
    referenceFormat: 'categorized',
    supportsImages: true,
    supportsVideos: true,
    supportsAudios: true,
    maxImages: 2,
    maxVideos: 1,
    maxAudios: 1,
    supportsResolution: true,
    supportsGenerateAudio: true,
    supportsAspectRatioField: false,
    supportsFirstLastFrame: false,
    durationOptions: [5, 10],
    ratios: ['16:9', '9:16'],
    resolutions: ['720p', '1080p'],
    ...overrides,
  }
}

function baseOptions(extra: Record<string, unknown> = {}) {
  return {
    provider: 'tgg',
    modelId: 'tgg-fixture-video',
    modelKey: 'tgg::tgg-fixture-video',
    duration: 5,
    ...extra,
  }
}

function submittedBody(): Record<string, unknown> {
  return JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body)) as Record<string, unknown>
}

describe('tgg video adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getProviderConfigMock.mockResolvedValue({ apiKey: 'tgg-test-secret-value', baseUrl: 'https://tggtoken.org' })
    normalizeReferencesMock.mockImplementation(async (images: string[]) => images)
    normalizeMediaMock.mockImplementation(async (url: string) => url)
    definitionMock.mockReturnValue(definition())
    fetchMock.mockResolvedValue(jsonResponse({ id: 'task-1' }))
  })

  it('submits the categorized wire format with seconds, ratio and long-lived reference urls', async () => {
    const result = await generateTggVideo({
      userId: 'user-1',
      imageUrl: 'https://cdn.example/first.png',
      prompt: '  slow pan  ',
      options: baseOptions({
        referenceImages: ['https://cdn.example/ref.png'],
        videos: ['https://cdn.example/ref.mp4'],
        audios: ['https://cdn.example/ref.mp3'],
        aspectRatio: '16:9',
        resolution: '720p',
        generateAudio: true,
      }),
    })

    expect(getProviderConfigMock).toHaveBeenCalledWith('user-1', 'tgg')
    expect(normalizeReferencesMock).toHaveBeenCalledWith(
      ['https://cdn.example/first.png', 'https://cdn.example/ref.png'],
      { context: { provider: 'tgg', modelId: 'tgg-fixture-video' }, ttlSeconds: 21600 },
    )
    expect(normalizeMediaMock).toHaveBeenCalledWith('https://cdn.example/ref.mp4', { ttlSeconds: 21600 })
    expect(normalizeMediaMock).toHaveBeenCalledWith('https://cdn.example/ref.mp3', { ttlSeconds: 21600 })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://tggtoken.org/v1/videos')
    expect(init.headers).toMatchObject({ Authorization: 'Bearer tgg-test-secret-value' })
    expect(submittedBody()).toEqual({
      model: 'tgg-fixture-video',
      prompt: 'slow pan',
      seconds: 5,
      ratio: '16:9',
      resolution: '720p',
      generate_audio: true,
      images: ['https://cdn.example/first.png', 'https://cdn.example/ref.png'],
      videos: ['https://cdn.example/ref.mp4'],
      audios: ['https://cdn.example/ref.mp3'],
    })
    expect(result).toMatchObject({ success: true, async: true, requestId: 'task-1' })
    expect(result.externalId?.startsWith('TGG:VIDEO:')).toBe(true)
    expect(result.videoUrl).toBeUndefined()
  })

  it('submits the files wire format as a merged url list', async () => {
    definitionMock.mockReturnValue(definition({ referenceFormat: 'files' }))
    await generateTggVideo({
      userId: 'user-1',
      imageUrl: 'https://cdn.example/first.png',
      prompt: 'pan',
      options: baseOptions({ videos: ['https://cdn.example/ref.mp4'] }),
    })
    expect(submittedBody()).toEqual({
      model: 'tgg-fixture-video',
      prompt: 'pan',
      seconds: 5,
      files: [{ url: 'https://cdn.example/first.png' }, { url: 'https://cdn.example/ref.mp4' }],
    })
  })

  it('submits the files-named wire format with decoded real file names', async () => {
    definitionMock.mockReturnValue(definition({ referenceFormat: 'files-named' }))
    await generateTggVideo({
      userId: 'user-1',
      imageUrl: 'https://cdn.example/%E8%A7%86%E9%A2%91.mp4?sig=a',
      prompt: 'pan',
      options: baseOptions(),
    })
    expect(submittedBody().files).toEqual([{ url: 'https://cdn.example/%E8%A7%86%E9%A2%91.mp4?sig=a', name: '视频.mp4' }])
  })

  it('refuses to fabricate file names for extension-less urls', async () => {
    definitionMock.mockReturnValue(definition({ referenceFormat: 'files-named' }))
    await expect(generateTggVideo({
      userId: 'user-1',
      imageUrl: 'https://cdn.example/media/abc123',
      prompt: 'pan',
      options: baseOptions(),
    })).rejects.toThrow('TGG_VIDEO_FILENAME_REQUIRED')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('adds aspect_ratio only for models whose profile declares the field', async () => {
    definitionMock.mockReturnValue(definition({ supportsAspectRatioField: true }))
    await generateTggVideo({
      userId: 'user-1',
      imageUrl: 'https://cdn.example/first.png',
      prompt: 'pan',
      options: baseOptions({ aspectRatio: '9:16' }),
    })
    expect(submittedBody()).toMatchObject({ ratio: '9:16', aspect_ratio: '9:16' })
  })

  it('requires a prompt and a supported integer duration', async () => {
    await expect(generateTggVideo({ userId: 'user-1', imageUrl: 'https://cdn.example/a.png', options: baseOptions() }))
      .rejects.toThrow('TGG_VIDEO_PROMPT_REQUIRED')
    await expect(generateTggVideo({ userId: 'user-1', imageUrl: 'https://cdn.example/a.png', prompt: 'pan', options: baseOptions({ duration: undefined }) }))
      .rejects.toThrow('TGG_VIDEO_DURATION_REQUIRED')
    await expect(generateTggVideo({ userId: 'user-1', imageUrl: 'https://cdn.example/a.png', prompt: 'pan', options: baseOptions({ duration: 7 }) }))
      .rejects.toThrow('TGG_VIDEO_DURATION_UNSUPPORTED: 7 (allowed: 5, 10)')
    expect(fetchMock).not.toHaveBeenCalled()

    await generateTggVideo({ userId: 'user-1', imageUrl: 'https://cdn.example/a.png', prompt: 'pan', options: baseOptions({ duration: '10' }) })
    expect(submittedBody().seconds).toBe(10)
  })

  it('falls back to options.prompt and omits adaptive ratios', async () => {
    await generateTggVideo({
      userId: 'user-1',
      imageUrl: 'https://cdn.example/a.png',
      options: baseOptions({ prompt: 'from options', aspectRatio: 'adaptive' }),
    })
    const body = submittedBody()
    expect(body.prompt).toBe('from options')
    expect(body).not.toHaveProperty('ratio')
  })

  it('rejects unsupported ratios and resolutions but omits resolution for models without the field', async () => {
    await expect(generateTggVideo({ userId: 'user-1', imageUrl: 'https://cdn.example/a.png', prompt: 'pan', options: baseOptions({ aspectRatio: '4:3' }) }))
      .rejects.toThrow('TGG_VIDEO_RATIO_UNSUPPORTED: 4:3')
    await expect(generateTggVideo({ userId: 'user-1', imageUrl: 'https://cdn.example/a.png', prompt: 'pan', options: baseOptions({ resolution: '4k' }) }))
      .rejects.toThrow('TGG_VIDEO_RESOLUTION_UNSUPPORTED: 4k')

    definitionMock.mockReturnValue(definition({ supportsResolution: false, resolutions: [] }))
    await generateTggVideo({ userId: 'user-1', imageUrl: 'https://cdn.example/a.png', prompt: 'pan', options: baseOptions({ resolution: '720p' }) })
    expect(submittedBody()).not.toHaveProperty('resolution')
  })

  it('omits generate_audio for models without the capability', async () => {
    definitionMock.mockReturnValue(definition({ supportsGenerateAudio: false }))
    await generateTggVideo({ userId: 'user-1', imageUrl: 'https://cdn.example/a.png', prompt: 'pan', options: baseOptions({ generateAudio: true }) })
    expect(submittedBody()).not.toHaveProperty('generate_audio')
  })

  it('fails loudly on last-frame requests instead of dropping them', async () => {
    await expect(generateTggVideo({
      userId: 'user-1',
      imageUrl: 'https://cdn.example/a.png',
      prompt: 'pan',
      options: baseOptions({ lastFrameImageUrl: 'https://cdn.example/last.png' }),
    })).rejects.toThrow('TGG_VIDEO_FIRST_LAST_FRAME_UNSUPPORTED')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('enforces per-type reference limits from the capability json', async () => {
    await expect(generateTggVideo({
      userId: 'user-1',
      imageUrl: 'https://cdn.example/a.png',
      prompt: 'pan',
      options: baseOptions({ referenceImages: ['https://cdn.example/b.png', 'https://cdn.example/c.png'] }),
    })).rejects.toThrow('TGG_VIDEO_REFERENCES_LIMIT_EXCEEDED: images=3')

    await expect(generateTggVideo({
      userId: 'user-1',
      imageUrl: 'https://cdn.example/a.png',
      prompt: 'pan',
      options: baseOptions({ videos: ['https://cdn.example/v1.mp4', 'https://cdn.example/v2.mp4'] }),
    })).rejects.toThrow('TGG_VIDEO_REFERENCES_LIMIT_EXCEEDED: videos=2')

    await expect(generateTggVideo({
      userId: 'user-1',
      imageUrl: 'https://cdn.example/a.png',
      prompt: 'pan',
      options: baseOptions({ audios: ['https://cdn.example/a1.mp3', 'https://cdn.example/a2.mp3'] }),
    })).rejects.toThrow('TGG_VIDEO_REFERENCES_LIMIT_EXCEEDED: audios=2')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('requires publicly fetchable video and audio references', async () => {
    normalizeMediaMock.mockResolvedValueOnce('/m/video/local-only')
    await expect(generateTggVideo({
      userId: 'user-1',
      imageUrl: 'https://cdn.example/a.png',
      prompt: 'pan',
      options: baseOptions({ videos: ['/m/video/local-only'] }),
    })).rejects.toThrow('TGG_MEDIA_URL_PUBLIC_REQUIRED')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('never retries a failed submission and reports missing task ids', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'))
    await expect(generateTggVideo({ userId: 'user-1', imageUrl: 'https://cdn.example/a.png', prompt: 'pan', options: baseOptions() }))
      .rejects.toThrow('TGG_SUBMIT_UNCONFIRMED')
    expect(fetchMock).toHaveBeenCalledTimes(1)

    fetchMock.mockResolvedValueOnce(jsonResponse({ object: 'video' }))
    await expect(generateTggVideo({ userId: 'user-1', imageUrl: 'https://cdn.example/a.png', prompt: 'pan', options: baseOptions() }))
      .rejects.toThrow('TGG_VIDEO_TASK_ID_MISSING')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
