import { beforeEach, describe, expect, it, vi } from 'vitest'

const getProviderConfigMock = vi.hoisted(() => vi.fn())
const normalizeReferencesMock = vi.hoisted(() => vi.fn())
const normalizeImageMock = vi.hoisted(() => vi.fn())
const normalizeMediaMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api-config', () => ({ getProviderConfig: getProviderConfigMock }))
vi.mock('@/lib/media/outbound-image', () => ({
  normalizeReferenceImagesForGeneration: normalizeReferencesMock,
  normalizeToPublicImageUrlForGeneration: normalizeImageMock,
  normalizeToOriginalMediaUrl: normalizeMediaMock,
}))

import { generateHuimengiImage } from '@/lib/providers/huimengi/image'
import { generateHuimengiVideo } from '@/lib/providers/huimengi/video'
import { queryHuimengiTaskStatus } from '@/lib/providers/huimengi/poll'

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('HuiMeng media adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getProviderConfigMock.mockResolvedValue({ apiKey: 'hm-test-secret-value', baseUrl: 'https://api.huimengi.com/' })
    normalizeReferencesMock.mockImplementation(async (images: string[]) => images)
    normalizeImageMock.mockImplementation(async (image: string) => image)
    normalizeMediaMock.mockImplementation(async (url: string) => url)
  })

  it('submits documented image parameters and returns a resumable external id', async () => {
    normalizeReferencesMock.mockResolvedValueOnce(['https://cdn.example/a.png', 'https://cdn.example/b.png'])
    fetchMock.mockResolvedValueOnce(jsonResponse({ task_id: 'image task/1' }))

    const result = await generateHuimengiImage({
      userId: 'user-1',
      prompt: '  cinematic portrait  ',
      referenceImages: ['a', 'b'],
      options: {
        provider: 'huimengi',
        modelId: 'qwen-image-3.0-pro',
        modelKey: 'huimengi::qwen-image-3.0-pro',
        aspectRatio: '16:9',
        resolution: '2K',
        n: 2,
        seed: 7,
        negativePrompt: 'blurry',
        promptExtend: false,
        watermark: true,
      },
    })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.huimengi.com/api/v1/tasks')
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({ Authorization: 'Bearer hm-test-secret-value' })
    expect(JSON.parse(String(init.body))).toEqual({
      model: 'qwen-image-3.0-pro',
      params: {
        prompt: 'cinematic portrait',
        image: ['https://cdn.example/a.png', 'https://cdn.example/b.png'],
        ratio: '16:9',
        resolution: '2k',
        n: 2,
        seed: 7,
        negative_prompt: 'blurry',
        prompt_extend: false,
        watermark: true,
      },
    })
    expect(result).toMatchObject({ success: true, async: true, requestId: 'image task/1' })
    expect(result.externalId?.startsWith('HUIMENGI:IMAGE:')).toBe(true)
  })

  it('maps first and last frames, references, audio and duration for video', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'video-1' }))
    const result = await generateHuimengiVideo({
      userId: 'user-1',
      imageUrl: 'https://cdn.example/first.png',
      prompt: 'slow pan',
      options: {
        provider: 'huimengi',
        modelId: 'wan3.0-video',
        modelKey: 'huimengi::wan3.0-video',
        lastFrameImageUrl: 'https://cdn.example/last.png',
        referenceImages: ['https://cdn.example/ref.png'],
        videos: ['https://cdn.example/ref.mp4'],
        audios: ['https://cdn.example/ref.mp3'],
        aspectRatio: '16:9',
        resolution: '1080p',
        duration: 8,
        seed: 42,
        generateAudio: false,
        promptExtend: false,
        watermark: false,
      },
    })

    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toEqual({
      model: 'wan3.0-video',
      params: {
        prompt: 'slow pan',
        first_frame_image: 'https://cdn.example/first.png',
        last_frame_image: 'https://cdn.example/last.png',
        reference_images: ['https://cdn.example/ref.png'],
        reference_videos: ['https://cdn.example/ref.mp4'],
        reference_audios: ['https://cdn.example/ref.mp3'],
        ratio: '16:9',
        resolution: '1080P',
        duration: 8,
        seed: 42,
        audio: false,
        prompt_extend: false,
        watermark: false,
      },
    })
    expect(result).toMatchObject({ success: true, async: true, requestId: 'video-1' })
  })

  it('uses the documented first_frame_image field and multimodal references for Seedance 2.5', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ task_id: 'seedance-25' }))
    const result = await generateHuimengiVideo({
      userId: 'user-1',
      imageUrl: 'https://cdn.example/first.png',
      prompt: 'camera pushes in',
      options: {
        provider: 'huimengi',
        modelId: 'seedance-2.5',
        modelKey: 'huimengi::seedance-2.5',
        referenceImages: ['https://cdn.example/ref-a.png', 'https://cdn.example/ref-b.png'],
        videos: ['https://cdn.example/ref.mp4'],
        audios: ['https://cdn.example/ref.mp3'],
        aspectRatio: '16:9',
        resolution: '1080p',
        duration: 10,
        generateAudio: true,
        returnLastFrame: false,
      },
    })

    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toEqual({
      model: 'seedance-2.5',
      params: {
        prompt: 'camera pushes in',
        first_frame_image: 'https://cdn.example/first.png',
        reference_images: ['https://cdn.example/ref-a.png', 'https://cdn.example/ref-b.png'],
        reference_videos: ['https://cdn.example/ref.mp4'],
        reference_audios: ['https://cdn.example/ref.mp3'],
        ratio: '16:9',
        resolution: '1080p',
        duration: 10,
        generate_audio: true,
        return_last_frame: false,
      },
    })
    expect(result).toMatchObject({ success: true, async: true, requestId: 'seedance-25' })

    await expect(generateHuimengiVideo({
      userId: 'user-1',
      imageUrl: '',
      prompt: 'too many videos',
      options: {
        provider: 'huimengi',
        modelId: 'seedance-2.5',
        modelKey: 'huimengi::seedance-2.5',
        videos: Array.from({ length: 11 }, (_, index) => `https://cdn.example/v${index}.mp4`),
      },
    })).rejects.toThrow('HUIMENGI_VIDEO_REFERENCE_VIDEOS_LIMIT')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('rejects invalid parameters and missing task ids without paid submission', async () => {
    await expect(generateHuimengiImage({
      userId: 'user-1',
      prompt: 'portrait',
      options: { provider: 'huimengi', modelId: 'seedream-5.0-pro', modelKey: 'x', resolution: '4K' },
    })).rejects.toThrow('HUIMENGI_IMAGE_RESOLUTION_UNSUPPORTED')
    expect(fetchMock).not.toHaveBeenCalled()

    await expect(generateHuimengiVideo({
      userId: 'user-1',
      imageUrl: '',
      prompt: 'animate',
      options: { provider: 'huimengi', modelId: 'happyhorse-1.1', modelKey: 'x', lastFrameImageUrl: 'https://cdn.example/last.png' },
    })).rejects.toThrow('HUIMENGI_VIDEO_LAST_FRAME_UNSUPPORTED')

    fetchMock.mockResolvedValueOnce(jsonResponse({ task_id: '' }))
    await expect(generateHuimengiImage({
      userId: 'user-1',
      prompt: 'portrait',
      options: { provider: 'huimengi', modelId: 'seedream-5.0-pro', modelKey: 'x' },
    })).rejects.toThrow('HUIMENGI_IMAGE_TASK_ID_MISSING')
  })

  it('preserves every completed image URL and escapes task id path segments', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      status: 'completed',
      result: {
        image_url: 'https://cdn.example/first.png',
        image_urls: ['https://cdn.example/first.png', 'https://cdn.example/second.png'],
      },
    }))
    await expect(queryHuimengiTaskStatus({ type: 'IMAGE', taskId: 'image task/1', apiKey: 'hm-test-secret-value' })).resolves.toEqual({
      status: 'completed',
      resultUrl: 'https://cdn.example/first.png',
      imageUrl: 'https://cdn.example/first.png',
      imageUrls: ['https://cdn.example/first.png', 'https://cdn.example/second.png'],
    })
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.huimengi.com/api/v1/tasks/image%20task%2F1')
  })

  it('reads video result metadata and pending states', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      status: 'succeeded',
      result: { video_url: 'https://cdn.example/result.mp4', completion_tokens: 108900, duration: 8, resolution: '1080p', ratio: '16:9', generate_audio: true },
    }))
    await expect(queryHuimengiTaskStatus({ type: 'VIDEO', taskId: 'task-1', apiKey: 'hm-test-secret-value' })).resolves.toMatchObject({
      status: 'completed', resultUrl: 'https://cdn.example/result.mp4', videoUrl: 'https://cdn.example/result.mp4', actualVideoTokens: 108900, durationSeconds: 8, resolution: '1080p', aspectRatio: '16:9', generateAudio: true,
    })

    fetchMock.mockResolvedValueOnce(jsonResponse({ status: 'running' }))
    await expect(queryHuimengiTaskStatus({ type: 'VIDEO', taskId: 'task-1', apiKey: 'hm-test-secret-value' })).resolves.toEqual({ status: 'pending' })
  })

  it('sanitizes failed task and HTTP error details', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      status: 'failed',
      error_message: 'invalid key hm-test-secret-value at https://api.huimengi.com/private?token=secret',
    }))
    const failed = await queryHuimengiTaskStatus({ type: 'IMAGE', taskId: 'task-1', apiKey: 'hm-test-secret-value' })
    expect(failed.status).toBe('failed')
    expect(failed.error).not.toContain('hm-test-secret-value')
    expect(failed.error).not.toContain('token=secret')

    fetchMock.mockResolvedValueOnce(jsonResponse({ detail: { message: 'Bearer hm-test-secret-value' } }, 401))
    const httpError = await queryHuimengiTaskStatus({ type: 'IMAGE', taskId: 'task-1', apiKey: 'hm-test-secret-value' })
    expect(httpError.status).toBe('failed')
    expect(httpError.error).toContain('HUIMENGI_HTTP_ERROR(401)')
    expect(httpError.error).not.toContain('hm-test-secret-value')
  })
})
