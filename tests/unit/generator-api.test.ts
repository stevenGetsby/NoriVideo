import { beforeEach, describe, expect, it, vi } from 'vitest'

const resolveModelSelectionMock = vi.hoisted(() =>
  vi.fn<typeof import('@/lib/api-config').resolveModelSelection>(),
)

const generateOpenLuxImageMock = vi.hoisted(() =>
  vi.fn(async () => ({ success: true, imageUrl: 'https://cdn.example.com/openlux.png', requestId: 'ol-image' })),
)
const generateKuaiziVideoMock = vi.hoisted(() =>
  vi.fn(async () => ({ success: true, async: true, requestId: 'kz-video', externalId: 'KUAIZI:VIDEO:mock' })),
)
const generateKuaiziAudioMock = vi.hoisted(() =>
  vi.fn(async () => ({ success: true, async: true, requestId: 'kz-audio', externalId: 'KUAIZI:AUDIO:mock' })),
)
const generateHuimengiImageMock = vi.hoisted(() =>
  vi.fn(async () => ({ success: true, async: true, requestId: 'hm-image', externalId: 'HUIMENGI:IMAGE:mock' })),
)
const generateHuimengiVideoMock = vi.hoisted(() =>
  vi.fn(async () => ({ success: true, async: true, requestId: 'hm-video', externalId: 'HUIMENGI:VIDEO:mock' })),
)

vi.mock('@/lib/api-config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api-config')>()
  return {
    ...actual,
    resolveModelSelection: resolveModelSelectionMock,
  }
})

vi.mock('@/lib/providers/openlux', () => ({
  generateOpenLuxImage: generateOpenLuxImageMock,
}))

vi.mock('@/lib/providers/kuaizi', () => ({
  generateKuaiziVideo: generateKuaiziVideoMock,
  generateKuaiziAudio: generateKuaiziAudioMock,
}))

vi.mock('@/lib/providers/huimengi', () => ({
  generateHuimengiImage: generateHuimengiImageMock,
  generateHuimengiVideo: generateHuimengiVideoMock,
}))

import { generateAudio, generateImage, generateVideo } from '@/lib/generator-api'

describe('generator-api fixed provider dispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('routes images to OpenLux and video/audio to Kuaizi', async () => {
    resolveModelSelectionMock
      .mockResolvedValueOnce({
        provider: 'openlux',
        modelId: 'gpt-image-2.5-sunburst',
        modelKey: 'openlux::gpt-image-2.5-sunburst',
        mediaType: 'image',
      })
      .mockResolvedValueOnce({
        provider: 'kuaizi',
        modelId: 'doubao-seedance-2-0-fast-260128',
        modelKey: 'kuaizi::doubao-seedance-2-0-fast-260128',
        mediaType: 'video',
      })
      .mockResolvedValueOnce({
        provider: 'kuaizi',
        modelId: 'speech-2.8-hd',
        modelKey: 'kuaizi::speech-2.8-hd',
        mediaType: 'audio',
      })

    const image = await generateImage('user-1', 'openlux::gpt-image-2.5-sunburst', 'draw sky')
    const video = await generateVideo(
      'user-1',
      'kuaizi::doubao-seedance-2-0-fast-260128',
      '',
      { prompt: 'animate sky', referenceImages: ['asset://1'] },
    )
    const audio = await generateAudio('user-1', 'kuaizi::speech-2.8-hd', 'hello', { voice: 'voice-1' })

    expect(generateOpenLuxImageMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      prompt: 'draw sky',
      options: expect.objectContaining({
        provider: 'openlux',
        modelId: 'gpt-image-2.5-sunburst',
      }),
    }))
    expect(generateKuaiziVideoMock).toHaveBeenCalledWith(expect.objectContaining({
      imageUrl: '',
      prompt: 'animate sky',
      options: expect.objectContaining({
        modelId: 'doubao-seedance-2-0-fast-260128',
        referenceImages: ['asset://1'],
      }),
    }))
    expect(generateKuaiziAudioMock).toHaveBeenCalledWith(expect.objectContaining({
      text: 'hello',
      voice: 'voice-1',
      options: expect.objectContaining({ modelId: 'speech-2.8-hd' }),
    }))
    expect(image).toMatchObject({ requestId: 'ol-image', imageUrl: 'https://cdn.example.com/openlux.png' })
    expect(video).toMatchObject({ requestId: 'kz-video', externalId: 'KUAIZI:VIDEO:mock' })
    expect(audio).toMatchObject({ requestId: 'kz-audio', externalId: 'KUAIZI:AUDIO:mock' })
  })

  it('routes images and video to HuiMeng when the platform selects it', async () => {
    resolveModelSelectionMock
      .mockResolvedValueOnce({
        provider: 'huimengi',
        modelId: 'seedream-5.0-pro',
        modelKey: 'huimengi::seedream-5.0-pro',
        mediaType: 'image',
      })
      .mockResolvedValueOnce({
        provider: 'huimengi',
        modelId: 'wan3.0-video',
        modelKey: 'huimengi::wan3.0-video',
        mediaType: 'video',
      })

    const image = await generateImage('user-1', 'huimengi::seedream-5.0-pro', 'draw sky')
    const video = await generateVideo(
      'user-1',
      'huimengi::wan3.0-video',
      'https://cdn.example.com/a.png',
      { prompt: 'animate sky', duration: 5, resolution: '720p' },
    )

    expect(generateHuimengiImageMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      prompt: 'draw sky',
      options: expect.objectContaining({ provider: 'huimengi', modelId: 'seedream-5.0-pro' }),
    }))
    expect(generateHuimengiVideoMock).toHaveBeenCalledWith(expect.objectContaining({
      imageUrl: 'https://cdn.example.com/a.png',
      prompt: 'animate sky',
      options: expect.objectContaining({ provider: 'huimengi', modelId: 'wan3.0-video' }),
    }))
    expect(generateOpenLuxImageMock).not.toHaveBeenCalled()
    expect(generateKuaiziVideoMock).not.toHaveBeenCalled()
    expect(image).toMatchObject({ externalId: 'HUIMENGI:IMAGE:mock' })
    expect(video).toMatchObject({ externalId: 'HUIMENGI:VIDEO:mock' })
  })

  it('hard-rejects retired providers for image, video and audio', async () => {
    resolveModelSelectionMock
      .mockResolvedValueOnce({
        provider: 'hfsy',
        modelId: 'gpt-image-2',
        modelKey: 'hfsy::gpt-image-2',
        mediaType: 'image',
      })
      .mockResolvedValueOnce({
        provider: 'ark',
        modelId: 'doubao-seedance-2-0-260128',
        modelKey: 'ark::doubao-seedance-2-0-260128',
        mediaType: 'video',
      })
      .mockResolvedValueOnce({
        provider: 'bailian',
        modelId: 'qwen3-tts',
        modelKey: 'bailian::qwen3-tts',
        mediaType: 'audio',
      })

    await expect(generateImage('user-1', 'hfsy::gpt-image-2', 'draw')).rejects.toThrow('MEDIA_PROVIDER_UNSUPPORTED')
    await expect(generateVideo('user-1', 'ark::doubao-seedance-2-0-260128', 'https://example.com/a.png'))
      .rejects.toThrow('MEDIA_PROVIDER_UNSUPPORTED')
    await expect(generateAudio('user-1', 'bailian::qwen3-tts', 'hello')).rejects.toThrow('MEDIA_PROVIDER_UNSUPPORTED')

    expect(generateOpenLuxImageMock).not.toHaveBeenCalled()
    expect(generateKuaiziVideoMock).not.toHaveBeenCalled()
    expect(generateKuaiziAudioMock).not.toHaveBeenCalled()
    expect(generateHuimengiImageMock).not.toHaveBeenCalled()
    expect(generateHuimengiVideoMock).not.toHaveBeenCalled()
  })

  it('rejects image generation routed to Kuaizi', async () => {
    resolveModelSelectionMock.mockResolvedValueOnce({
      provider: 'kuaizi',
      modelId: 'seedream5.0lite',
      modelKey: 'kuaizi::seedream5.0lite',
      mediaType: 'image',
    })

    await expect(generateImage('user-1', 'kuaizi::seedream5.0lite', 'draw')).rejects.toThrow('MEDIA_PROVIDER_UNSUPPORTED')
    expect(generateOpenLuxImageMock).not.toHaveBeenCalled()
  })

  it('rejects video and audio routed to OpenLux', async () => {
    resolveModelSelectionMock
      .mockResolvedValueOnce({
        provider: 'openlux',
        modelId: 'gpt-image-2.5-flare',
        modelKey: 'openlux::gpt-image-2.5-flare',
        mediaType: 'video',
      })
      .mockResolvedValueOnce({
        provider: 'openlux',
        modelId: 'gpt-image-2.5-flare',
        modelKey: 'openlux::gpt-image-2.5-flare',
        mediaType: 'audio',
      })

    await expect(generateVideo('user-1', 'openlux::gpt-image-2.5-flare', 'https://example.com/a.png'))
      .rejects.toThrow('MEDIA_PROVIDER_UNSUPPORTED')
    await expect(generateAudio('user-1', 'openlux::gpt-image-2.5-flare', 'hello'))
      .rejects.toThrow('MEDIA_PROVIDER_UNSUPPORTED')
    expect(generateKuaiziVideoMock).not.toHaveBeenCalled()
    expect(generateKuaiziAudioMock).not.toHaveBeenCalled()
  })

  it('passes canvas inpaint input to the OpenLux adapter', async () => {
    resolveModelSelectionMock.mockResolvedValueOnce({
      provider: 'openlux',
      modelId: 'gpt-image-2.5-sunburst',
      modelKey: 'openlux::gpt-image-2.5-sunburst',
      mediaType: 'image',
    })

    await generateImage('user-1', 'openlux::gpt-image-2.5-sunburst', 'replace window', {
      referenceImages: ['data:image/png;base64,U09VUkNF'],
      editMode: 'inpaint',
      maskImage: 'data:image/png;base64,TUFTSw==',
    })

    expect(generateOpenLuxImageMock).toHaveBeenCalledWith(expect.objectContaining({
      referenceImages: ['data:image/png;base64,U09VUkNF'],
      editMode: 'inpaint',
      maskImage: 'data:image/png;base64,TUFTSw==',
    }))
  })

  it('rejects mask editing without the inpaint contract', async () => {
    resolveModelSelectionMock.mockResolvedValueOnce({
      provider: 'openlux',
      modelId: 'gpt-image-2.5-sunburst',
      modelKey: 'openlux::gpt-image-2.5-sunburst',
      mediaType: 'image',
    })

    await expect(generateImage('user-1', 'openlux::gpt-image-2.5-sunburst', 'replace window', {
      referenceImages: ['data:image/png;base64,U09VUkNF'],
      maskImage: 'data:image/png;base64,TUFTSw==',
    })).rejects.toThrow('CANVAS_IMAGE_INPAINT_CONTRACT_INVALID')
    expect(generateOpenLuxImageMock).not.toHaveBeenCalled()
  })
})
