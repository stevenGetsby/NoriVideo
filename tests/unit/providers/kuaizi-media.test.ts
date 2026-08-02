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
          content: [{ type: 'video_url', video_url: { url: 'https://example.com/seedance.mp4' } }],
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
