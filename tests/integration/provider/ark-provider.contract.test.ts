import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { arkCreateVideoTask } from '@/lib/ark-api'
import { querySeedanceVideoStatus } from '@/lib/async-task-utils'
import { ArkVideoGenerator } from '@/lib/generators/ark'

vi.mock('@/lib/api-config', () => ({
  getProviderConfig: vi.fn(async () => ({ apiKey: 'ark-key' })),
}))

vi.mock('@/lib/media/outbound-image', () => ({
  normalizeToBase64ForGeneration: vi.fn(async (input: string) => `data:image/png;base64,normalized:${input}`),
}))

describe('provider contract - ark seedance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('submits Seedance 2.0 multimodal create payload with official request fields', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 'cgt-task-1' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)

    const result = await arkCreateVideoTask({
      model: 'doubao-seedance-2-0-260128',
      content: [
        { type: 'text', text: 'reference 视频1 的运镜，参考音频1 的节奏' },
        { type: 'image_url', image_url: { url: 'https://example.com/first.png' }, role: 'reference_image' },
        { type: 'video_url', video_url: { url: 'https://example.com/ref.mp4' }, role: 'reference_video' },
        { type: 'audio_url', audio_url: { url: 'https://example.com/ref.mp3' }, role: 'reference_audio' },
      ],
      resolution: '720p',
      ratio: '16:9',
      duration: 15,
      generate_audio: true,
      watermark: true,
      tools: [{ type: 'web_search' }],
    }, {
      apiKey: 'ark-key',
      maxRetries: 1,
      timeoutMs: 1000,
      logPrefix: '[Ark Test]',
    })

    expect(result.id).toBe('cgt-task-1')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const firstCall = fetchMock.mock.calls[0]
    expect(firstCall).toBeTruthy()
    const [url, init] = firstCall as unknown as [string, RequestInit]
    expect(url).toBe('https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks')
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ark-key',
    })
    expect(JSON.parse(String(init.body))).toEqual({
      model: 'doubao-seedance-2-0-260128',
      content: [
        { type: 'text', text: 'reference 视频1 的运镜，参考音频1 的节奏' },
        { type: 'image_url', image_url: { url: 'https://example.com/first.png' }, role: 'reference_image' },
        { type: 'video_url', video_url: { url: 'https://example.com/ref.mp4' }, role: 'reference_video' },
        { type: 'audio_url', audio_url: { url: 'https://example.com/ref.mp3' }, role: 'reference_audio' },
      ],
      resolution: '720p',
      ratio: '16:9',
      duration: 15,
      generate_audio: true,
      watermark: true,
      tools: [{ type: 'web_search' }],
    })
  })

  it('rejects mixed reference and first-frame content before submitting', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)

    await expect(arkCreateVideoTask({
      model: 'doubao-seedance-2-0-260128',
      content: [
        { type: 'text', text: 'Ava turns around.' },
        { type: 'image_url', image_url: { url: 'https://example.com/frame.png' }, role: 'first_frame' },
        { type: 'image_url', image_url: { url: 'https://example.com/ava.png' }, role: 'reference_image' },
      ],
    }, { apiKey: 'ark-key' })).rejects.toThrow(
      'ARK_VIDEO_REQUEST_INVALID: reference media cannot be mixed with first/last frame images',
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('ArkVideoGenerator injects the panel image and Seedance 2.0 options into content-generation tasks', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 'cgt-task-agent-1' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)

    const generator = new ArkVideoGenerator()
    const result = await generator.generate({
      userId: 'user-1',
      imageUrl: 'https://assets.example/panel-1.png',
      prompt: 'Ava turns toward Dr. Grayson and says, "I need the truth." Camera slowly pushes in.',
      options: {
        modelId: 'doubao-seedance-2-0-260128',
        resolution: '720p',
        duration: 7,
        aspectRatio: '9:16',
        generateAudio: true,
      },
    })

    expect(result).toEqual({
      success: true,
      async: true,
      requestId: 'cgt-task-agent-1',
      externalId: 'ARK:VIDEO:cgt-task-agent-1',
    })
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({
      model: 'doubao-seedance-2-0-260128',
      content: [
        { type: 'text', text: 'Ava turns toward Dr. Grayson and says, "I need the truth." Camera slowly pushes in.' },
        {
          type: 'image_url',
          image_url: { url: 'data:image/png;base64,normalized:https://assets.example/panel-1.png' },
          role: 'first_frame',
        },
      ],
      resolution: '720p',
      ratio: '9:16',
      duration: 7,
      generate_audio: true,
    })
  })

  it('ArkVideoGenerator can submit Seedance 2.0 text plus asset reference images without a panel image', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 'cgt-task-agent-refs' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)

    const generator = new ArkVideoGenerator()
    const result = await generator.generate({
      userId: 'user-1',
      imageUrl: '',
      prompt: '场景：现代美国私立医院。剧情片段：Ava 请求 Dr. Grayson 帮外婆安排手术。',
      options: {
        modelId: 'doubao-seedance-2-0-260128',
        resolution: '720p',
        duration: 8,
        aspectRatio: '9:16',
        generateAudio: true,
        referenceImages: [
          'https://assets.example/ava.png',
          'https://assets.example/grayson.png',
          'https://assets.example/hospital.png',
        ],
      },
    })

    expect(result).toEqual({
      success: true,
      async: true,
      requestId: 'cgt-task-agent-refs',
      externalId: 'ARK:VIDEO:cgt-task-agent-refs',
    })
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({
      model: 'doubao-seedance-2-0-260128',
      content: [
        { type: 'text', text: '场景：现代美国私立医院。剧情片段：Ava 请求 Dr. Grayson 帮外婆安排手术。' },
        {
          type: 'image_url',
          image_url: { url: 'data:image/png;base64,normalized:https://assets.example/ava.png' },
          role: 'reference_image',
        },
        {
          type: 'image_url',
          image_url: { url: 'data:image/png;base64,normalized:https://assets.example/grayson.png' },
          role: 'reference_image',
        },
        {
          type: 'image_url',
          image_url: { url: 'data:image/png;base64,normalized:https://assets.example/hospital.png' },
          role: 'reference_image',
        },
      ],
      resolution: '720p',
      ratio: '9:16',
      duration: 8,
      generate_audio: true,
    })
  })

  it('ArkVideoGenerator preserves official asset URIs in reference-image order', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 'cgt-task-agent-assets' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)

    const generator = new ArkVideoGenerator()
    await generator.generate({
      userId: 'user-1',
      imageUrl: '',
      prompt: '图片1中的苏晚卿走进图片2所示的陆府小院。',
      options: {
        modelId: 'doubao-seedance-2-0-260128',
        referenceImages: ['asset://char-su', 'asset://location-lu'],
      },
    })

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(String(init.body)).content).toEqual([
      { type: 'text', text: '图片1中的苏晚卿走进图片2所示的陆府小院。' },
      { type: 'image_url', image_url: { url: 'asset://char-su' }, role: 'reference_image' },
      { type: 'image_url', image_url: { url: 'asset://location-lu' }, role: 'reference_image' },
    ])
  })

  it('ArkVideoGenerator submits ordered Seedance 2.0 image, video, and audio references', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 'cgt-task-agent-mixed-refs' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)

    const generator = new ArkVideoGenerator()
    await generator.generate({
      userId: 'user-1',
      imageUrl: '',
      prompt: '参考图片1的角色造型、视频1和视频2的运镜，以及音频1和音频2的节奏。',
      options: {
        modelId: 'doubao-seedance-2-0-fast-260128',
        referenceImages: ['asset://character-1'],
        videos: [
          '  https://assets.example/reference-1.mp4  ',
          ' ',
          'https://assets.example/reference-2.mov?token=video',
        ],
        audios: [
          '',
          'https://assets.example/reference-1.mp3',
          '  https://assets.example/reference-2.wav?token=audio  ',
        ],
      },
    })

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(String(init.body)).content).toEqual([
      { type: 'text', text: '参考图片1的角色造型、视频1和视频2的运镜，以及音频1和音频2的节奏。' },
      { type: 'image_url', image_url: { url: 'asset://character-1' }, role: 'reference_image' },
      { type: 'video_url', video_url: { url: 'https://assets.example/reference-1.mp4' }, role: 'reference_video' },
      { type: 'video_url', video_url: { url: 'https://assets.example/reference-2.mov?token=video' }, role: 'reference_video' },
      { type: 'audio_url', audio_url: { url: 'https://assets.example/reference-1.mp3' }, role: 'reference_audio' },
      { type: 'audio_url', audio_url: { url: 'https://assets.example/reference-2.wav?token=audio' }, role: 'reference_audio' },
    ])
  })

  it.each([
    ['videos', ['https://assets.example/reference.mp4']],
    ['audios', ['https://assets.example/reference.mp3']],
  ])('ArkVideoGenerator rejects %s references for legacy Seedance models', async (optionName, media) => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)
    const generator = new ArkVideoGenerator()

    const result = await generator.generate({
      userId: 'user-1',
      imageUrl: '',
      prompt: 'Ava turns around.',
      options: {
        modelId: 'doubao-seedance-1-5-pro-251215',
        [optionName]: media,
      },
    })

    expect(result).toEqual({
      success: false,
      error: `ARK_VIDEO_OPTION_UNSUPPORTED: ${optionName} for doubao-seedance-1-5-pro-251215`,
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('ArkVideoGenerator rejects reference video or audio media mixed with a first frame', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)
    const generator = new ArkVideoGenerator()

    const result = await generator.generate({
      userId: 'user-1',
      imageUrl: 'https://assets.example/first-frame.png',
      prompt: 'Ava turns around.',
      options: {
        modelId: 'doubao-seedance-2-0-260128',
        videos: ['https://assets.example/reference.mp4'],
        audios: ['https://assets.example/reference.mp3'],
      },
    })

    expect(result).toEqual({
      success: false,
      error: 'ARK_VIDEO_REFERENCE_MODE_CONFLICT: reference media cannot be mixed with first/last frame images',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    ['videos', ['https://assets.example/1.mp4', 'https://assets.example/2.mp4', 'https://assets.example/3.mp4', 'https://assets.example/4.mp4'], 'ARK_VIDEO_OPTION_INVALID: videos supports at most 3 videos'],
    ['audios', ['file:///tmp/reference.mp3'], 'ARK_VIDEO_REFERENCE_AUDIO_INVALID: audios[0]'],
  ])('ArkVideoGenerator validates %s reference URLs and limits', async (optionName, media, expectedError) => {
    const generator = new ArkVideoGenerator()
    const result = await generator.generate({
      userId: 'user-1',
      imageUrl: '',
      prompt: 'Ava turns around.',
      options: {
        modelId: 'doubao-seedance-2-0-260128',
        [optionName]: media,
      },
    })

    expect(result).toEqual({ success: false, error: expectedError })
  })

  it('ArkVideoGenerator rejects mixed first-frame and reference-image modes', async () => {
    const generator = new ArkVideoGenerator()

    const result = await generator.generate({
      userId: 'user-1',
      imageUrl: 'https://assets.example/panel-1.png',
      prompt: 'Ava turns around.',
      options: {
        modelId: 'doubao-seedance-2-0-260128',
        referenceImages: ['https://assets.example/ava.png'],
      },
    })

    expect(result).toEqual({
      success: false,
      error: 'ARK_VIDEO_REFERENCE_MODE_CONFLICT: reference media cannot be mixed with first/last frame images',
    })
  })

  it('ArkVideoGenerator supports Seedance 2.0 auto duration and 1080p on the standard model', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 'cgt-task-agent-auto' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)

    const generator = new ArkVideoGenerator()
    await generator.generate({
      userId: 'user-1',
      imageUrl: 'https://assets.example/panel-1.png',
      prompt: 'Ava enters the operating corridor and looks toward Dr. Grayson.',
      options: {
        modelId: 'doubao-seedance-2-0-260128',
        resolution: '1080p',
        duration: -1,
        aspectRatio: '9:16',
        generateAudio: false,
      },
    })

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: 'doubao-seedance-2-0-260128',
      resolution: '1080p',
      ratio: '9:16',
      duration: -1,
      generate_audio: false,
    })
  })

  it('ArkVideoGenerator submits official Seedance 2.0 Pro 4k resolution without downgrading it', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 'cgt-task-agent-4k' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)

    const generator = new ArkVideoGenerator()
    const result = await generator.generate({
      userId: 'user-1',
      imageUrl: '',
      prompt: 'A wide establishing shot of a rain-soaked city at night.',
      options: {
        modelId: 'doubao-seedance-2-0-260128',
        resolution: '4k',
        duration: 5,
        aspectRatio: '16:9',
        generateAudio: true,
      },
    })

    expect(result.success).toBe(true)
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: 'doubao-seedance-2-0-260128',
      resolution: '4k',
      ratio: '16:9',
      duration: 5,
      generate_audio: true,
    })
  })

  it('ArkVideoGenerator rejects 1080p for Seedance 2.0 Fast', async () => {
    const generator = new ArkVideoGenerator()

    const result = await generator.generate({
      userId: 'user-1',
      imageUrl: 'https://assets.example/panel-1.png',
      prompt: 'Ava enters the operating corridor.',
      options: {
        modelId: 'doubao-seedance-2-0-fast-260128',
        resolution: '1080p',
        duration: -1,
        aspectRatio: '9:16',
      },
    })

    expect(result).toEqual({
      success: false,
      error: 'ARK_VIDEO_OPTION_VALUE_UNSUPPORTED: resolution=1080p',
    })
  })

  it('prefers Ark task usage.completion_tokens from status query', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      status: 'succeeded',
      content: {
        video_url: 'https://example.com/result.mp4',
      },
      usage: {
        total_tokens: 999999,
        completion_tokens: 108000,
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)

    const result = await querySeedanceVideoStatus('cgt-task-2', 'ark-key')

    expect(result).toEqual({
      status: 'completed',
      videoUrl: 'https://example.com/result.mp4',
      actualVideoTokens: 108000,
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/cgt-task-2',
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ark-key',
        },
        cache: 'no-store',
      },
    )
  })

  it('preserves Ark HTTP error code and message when polling fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      error: {
        code: 'ModelNotOpen',
        message: 'The account has not activated the model.',
      },
    }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    })) as unknown as typeof fetch)

    await expect(querySeedanceVideoStatus('cgt-task-denied', 'ark-key')).resolves.toEqual({
      status: 'failed',
      error: 'Seedance 状态查询失败（HTTP 403）（ModelNotOpen）：The account has not activated the model.',
    })
  })

  it('preserves provider task failure details returned by Seedance', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      status: 'failed',
      error: {
        code: 'InputImageSensitiveContentDetected',
        message: 'The reference image did not pass content moderation.',
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })) as unknown as typeof fetch)

    await expect(querySeedanceVideoStatus('cgt-task-filtered', 'ark-key')).resolves.toEqual({
      status: 'failed',
      error: 'Seedance 生成失败（InputImageSensitiveContentDetected）：The reference image did not pass content moderation.',
    })
  })
})
