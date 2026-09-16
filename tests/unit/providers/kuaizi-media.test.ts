import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getProviderConfigMock = vi.hoisted(() => vi.fn(async () => ({
  id: 'kuaizi',
  name: 'Kuaizi',
  apiKey: 'kuaizi-test-key',
  baseUrl: 'https://aiopenapi.kuaizi.cn',
})))

vi.mock('@/lib/api-config', () => ({
  getProviderConfig: getProviderConfigMock,
}))

import { generateKuaiziAudio } from '@/lib/providers/kuaizi/audio'
import { generateKuaiziImage } from '@/lib/providers/kuaizi/image'
import { queryKuaiziTaskStatus } from '@/lib/providers/kuaizi/poll'
import { generateKuaiziVideo } from '@/lib/providers/kuaizi/video'

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function requestAt(fetchMock: ReturnType<typeof vi.fn>, index = 0): [string, RequestInit] {
  const call = fetchMock.mock.calls[index] as unknown as [string, RequestInit] | undefined
  if (!call) throw new Error(`missing fetch call ${index}`)
  return call
}

describe('kuaizi media providers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.each(['expired', 'cancelled', 'failed'])('treats %s as terminal failure', async (status) => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ status })))
    const result = await queryKuaiziTaskStatus({
      type: 'VIDEO', modelId: 'doubao-seedance-2-5-260628', taskId: 'test',
      apiKey: 'test-only',
    })
    expect(result.status).toBe('failed')
  })

  it('preserves actual Seedance output parameters and prefers the durable video URL', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      status: 'succeeded',
      content: { video_url: 'https://test/temporary.mp4', kz_video_url: 'https://test/durable.mp4', last_frame_url: 'https://test/last.png' },
      duration: 6.25, resolution: '480p', ratio: '16:9', frames: 150, framespersecond: 24,
      generate_audio: false, seed: 123, usage: { completion_tokens: 120000 },
    })))
    expect(await queryKuaiziTaskStatus({
      type: 'VIDEO', modelId: 'doubao-seedance-2-5-260628', taskId: 'test',
      apiKey: 'test-only',
    })).toMatchObject({
      status: 'completed', videoUrl: 'https://test/durable.mp4', lastFrameUrl: 'https://test/last.png',
      durationSeconds: 6.25, resolution: '480p', aspectRatio: '16:9', frames: 150, fps: 24,
      generateAudio: false, seed: 123, actualVideoTokens: 120000,
    })
  })

  it('preserves long asset URIs for image, video and audio references without signing or fetching them', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ id: 'seedance-assets-test' }))
    vi.stubGlobal('fetch', fetchMock)
    const assetUri = 'asset://1800657071180349888'
    await generateKuaiziVideo({
      userId: 'u1', imageUrl: '', prompt: 'test',
      options: {
        provider: 'kuaizi', modelId: 'doubao-seedance-2-5-260628',
        modelKey: 'kuaizi::doubao-seedance-2-5-260628',
        referenceImages: [assetUri], videos: [assetUri], audios: [assetUri], duration: 5, resolution: '720p',
      },
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const body = JSON.parse(String(requestAt(fetchMock)[1].body))
    expect(body.content.slice(1)).toEqual([
      { type: 'image_url', image_url: { url: assetUri }, role: 'reference_image' },
      { type: 'video_url', video_url: { url: assetUri }, role: 'reference_video' },
      { type: 'audio_url', audio_url: { url: assetUri }, role: 'reference_audio' },
    ])
  })

  it('submits image generation and returns a durable task id', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      code: 0,
      data: { task_id: 'image-task-1' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await generateKuaiziImage({
      userId: 'user-1',
      prompt: 'draw a cat',
      referenceImages: ['https://example.com/reference.png'],
      options: {
        provider: 'kuaizi',
        modelId: 'seedream5.0pro',
        modelKey: 'kuaizi::seedream5.0pro',
        resolution: '3K',
      },
    })

    const [url, init] = requestAt(fetchMock)
    expect(url).toBe('https://aiopenapi.kuaizi.cn/ai-open-platform-api/v1/seedream/image/task/create')
    expect(init.headers).toEqual({ ApiKey: 'kuaizi-test-key', 'Content-Type': 'application/json' })
    expect(JSON.parse(String(init.body))).toEqual({
      model: 'seedream5.0pro',
      prompt: 'draw a cat',
      image: ['https://example.com/reference.png'],
      size: '3k',
    })
    expect(result).toMatchObject({
      success: true,
      async: true,
      requestId: 'image-task-1',
    })
    expect(result.externalId).toMatch(/^KUAIZI:IMAGE:/)
  })

  it('uses ApiKey for Kling and Bearer for all Seedance variants', async () => {
    const fetchMock = vi.fn(async (url: string) => (
      url.includes('/kling/')
        ? jsonResponse({ code: 0, data: { task_id: 'kling-task-1' } })
        : jsonResponse({ id: 'seedance-task-1' })
    ))
    vi.stubGlobal('fetch', fetchMock)

    await generateKuaiziVideo({
      userId: 'user-1',
      imageUrl: 'https://example.com/first.png',
      prompt: 'animate the scene',
      options: {
        provider: 'kuaizi',
        modelId: 'kling-v3-omni',
        modelKey: 'kuaizi::kling-v3-omni',
        duration: 5,
      },
    })
    const seedance = await generateKuaiziVideo({
      userId: 'user-1',
      imageUrl: '',
      prompt: 'a cinematic tracking shot',
      options: {
        provider: 'kuaizi',
        modelId: 'doubao-seedance-2-0-mini-260615',
        modelKey: 'kuaizi::doubao-seedance-2-0-mini-260615',
        resolution: '720p',
      },
    })

    const [, klingInit] = requestAt(fetchMock, 0)
    const [seedanceUrl, seedanceInit] = requestAt(fetchMock, 1)
    expect(klingInit.headers).toEqual({ ApiKey: 'kuaizi-test-key', 'Content-Type': 'application/json' })
    expect(seedanceUrl).toContain('/api/v3/contents/generations/tasks')
    expect(seedanceInit.headers).toEqual({
      Authorization: 'Bearer kuaizi-test-key',
      'Content-Type': 'application/json',
    })
    expect(JSON.parse(String(seedanceInit.body))).toMatchObject({
      model: 'doubao-seedance-2-0-mini-260615',
      resolution: '720p',
      content: [{ type: 'text', text: 'a cinematic tracking shot' }],
    })
    expect(seedance).toMatchObject({ success: true, async: true, requestId: 'seedance-task-1' })
  })

  it('aligns Seedance 2.5 request fields with the Kuaizi compatible API', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ id: 'seedance-25-task' }))
    vi.stubGlobal('fetch', fetchMock)

    await generateKuaiziVideo({
      userId: 'user-1',
      imageUrl: 'https://example.com/first.png',
      prompt: '让人物从清晨走到黄昏',
      options: {
        provider: 'kuaizi',
        modelId: 'doubao-seedance-2-5-260628',
        modelKey: 'kuaizi::doubao-seedance-2-5-260628',
        lastFrameImageUrl: 'https://example.com/last.png',
        resolution: '1080p',
        aspectRatio: '16:9',
        duration: 30,
        frames: 125,
        seed: 42,
        generateAudio: false,
        watermark: false,
        returnLastFrame: true,
        executionExpiresAfter: 7_200,
        moderationIps: ['ip-1'],
        safetyIdentifier: 'user-1',
        bitrateMode: 'standard',
        outputFormat: 'mp4',
      },
    })

    const [, init] = requestAt(fetchMock)
    expect(JSON.parse(String(init.body))).toEqual({
      model: 'doubao-seedance-2-5-260628',
      content: [
        { type: 'text', text: '让人物从清晨走到黄昏' },
        { type: 'image_url', image_url: { url: 'https://example.com/first.png' }, role: 'first_frame' },
        { type: 'image_url', image_url: { url: 'https://example.com/last.png' }, role: 'last_frame' },
      ],
      resolution: '1080p',
      ratio: 'adaptive',
      duration: 30,
      seed: 42,
      generate_audio: false,
      watermark: false,
      return_last_frame: true,
      execution_expires_after: 7_200,
      moderation_options: { ips: ['ip-1'] },
      safety_identifier: 'user-1',
      bitrate_mode: 'standard',
      output_format: 'mp4',
    })
  })

  it('uses explicit Seedance 2.5 edit constraints and permits prompt-backed audio-only reference', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ id: 'seedance-25-task' }))
    vi.stubGlobal('fetch', fetchMock)

    await generateKuaiziVideo({
      userId: 'user-1',
      imageUrl: '',
      prompt: 'change the sky to sunset',
      options: {
        provider: 'kuaizi',
        modelId: 'doubao-seedance-2-5-260628',
        modelKey: 'kuaizi::doubao-seedance-2-5-260628',
        videos: ['https://example.com/source.mp4'],
        aspectRatio: '9:16',
        duration: 12,
        omniReferenceTaskType: 'edit',
      },
    })
    await generateKuaiziVideo({
      userId: 'user-1',
      imageUrl: '',
      prompt: '根据节奏创作抽象动画',
      options: {
        provider: 'kuaizi',
        modelId: 'doubao-seedance-2-5-260628',
        modelKey: 'kuaizi::doubao-seedance-2-5-260628',
        audios: ['https://example.com/music.wav'],
      },
    })

    expect(JSON.parse(String(requestAt(fetchMock, 0)[1].body))).toMatchObject({
      ratio: 'adaptive',
      duration: -1,
      omni_reference_task_type: 'edit',
    })
    expect(JSON.parse(String(requestAt(fetchMock, 1)[1].body))).toMatchObject({
      content: [
        { type: 'text', text: '根据节奏创作抽象动画' },
        { type: 'audio_url', audio_url: { url: 'https://example.com/music.wav' }, role: 'reference_audio' },
      ],
    })
  })

  it('submits MiniMax TTS with the documented request shape', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ code: 0, data: { task_id: 'audio-task-1' } }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await generateKuaiziAudio({
      userId: 'user-1',
      text: '你好，世界',
      voice: 'male-qn-qingse',
      rate: 1.1,
      options: {
        provider: 'kuaizi',
        modelId: 'speech-2.8-hd',
        modelKey: 'kuaizi::speech-2.8-hd',
        languageBoost: 'Chinese',
      },
    })

    const [url, init] = requestAt(fetchMock)
    expect(url).toContain('/v1/minimax_t2a_async/task/create')
    expect(JSON.parse(String(init.body))).toEqual({
      text: '你好，世界',
      model: 'speech-2.8-hd',
      voice_setting: { voice_id: 'male-qn-qingse', speed: 1.1 },
      audio_setting: { format: 'mp3' },
      language_boost: 'Chinese',
    })
    expect(result).toMatchObject({ success: true, async: true, requestId: 'audio-task-1' })
    expect(result.externalId).toMatch(/^KUAIZI:AUDIO:/)
  })

  it('polls standard and Seedance tasks with their respective auth schemes', async () => {
    const fetchMock = vi.fn(async (url: string) => (
      url.includes('/api/v3/')
        ? jsonResponse({
          status: 'succeeded',
          content: {
            video_url: 'https://example.com/temporary-seedance.mp4',
            kz_video_url: 'https://example.com/seedance.mp4',
          },
          usage: { total_tokens: 321 },
        })
        : jsonResponse({
          code: 0,
          data: { status: 'succeeded', image_urls: ['https://example.com/image.png'] },
        })
    ))
    vi.stubGlobal('fetch', fetchMock)

    const image = await queryKuaiziTaskStatus({
      type: 'IMAGE',
      modelId: 'seedream5.0lite',
      taskId: 'image-task',
      apiKey: 'kuaizi-test-key',
    })
    const video = await queryKuaiziTaskStatus({
      type: 'VIDEO',
      modelId: 'doubao-seedance-2-0-fast-260128',
      taskId: 'video-task',
      apiKey: 'kuaizi-test-key',
    })

    expect(image).toEqual({
      status: 'completed',
      resultUrl: 'https://example.com/image.png',
      imageUrl: 'https://example.com/image.png',
    })
    expect(video).toEqual({
      status: 'completed',
      resultUrl: 'https://example.com/seedance.mp4',
      videoUrl: 'https://example.com/seedance.mp4',
      actualVideoTokens: 321,
    })
    expect(requestAt(fetchMock, 0)[1].headers).toHaveProperty('ApiKey', 'kuaizi-test-key')
    expect(requestAt(fetchMock, 1)[1].headers).toHaveProperty('Authorization', 'Bearer kuaizi-test-key')
  })
})
