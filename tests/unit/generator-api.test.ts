import { beforeEach, describe, expect, it, vi } from 'vitest'

const resolveModelSelectionMock = vi.hoisted(() =>
  vi.fn<typeof import('@/lib/api-config').resolveModelSelection>(),
)

const generateKuaiziImageMock = vi.hoisted(() =>
  vi.fn(async () => ({ success: true, async: true, requestId: 'kz-image', externalId: 'KUAIZI:IMAGE:mock' })),
)
const generateKuaiziVideoMock = vi.hoisted(() =>
  vi.fn(async () => ({ success: true, async: true, requestId: 'kz-video', externalId: 'KUAIZI:VIDEO:mock' })),
)
const generateKuaiziAudioMock = vi.hoisted(() =>
  vi.fn(async () => ({ success: true, async: true, requestId: 'kz-audio', externalId: 'KUAIZI:AUDIO:mock' })),
)

vi.mock('@/lib/api-config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api-config')>()
  return {
    ...actual,
    resolveModelSelection: resolveModelSelectionMock,
  }
})

vi.mock('@/lib/providers/kuaizi', () => ({
  generateKuaiziImage: generateKuaiziImageMock,
  generateKuaiziVideo: generateKuaiziVideoMock,
  generateKuaiziAudio: generateKuaiziAudioMock,
}))

import { generateAudio, generateImage, generateVideo } from '@/lib/generator-api'

describe('generator-api Kuaizi-only media execution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('routes Kuaizi image, video and audio to the Kuaizi adapters', async () => {
    resolveModelSelectionMock
      .mockResolvedValueOnce({
        provider: 'kuaizi',
        modelId: 'seedream5.0lite',
        modelKey: 'kuaizi::seedream5.0lite',
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

    const image = await generateImage('user-1', 'kuaizi::seedream5.0lite', 'draw sky')
    const video = await generateVideo(
      'user-1',
      'kuaizi::doubao-seedance-2-0-fast-260128',
      '',
      { prompt: 'animate sky', referenceImages: ['asset://1'] },
    )
    const audio = await generateAudio('user-1', 'kuaizi::speech-2.8-hd', 'hello', { voice: 'voice-1' })

    expect(generateKuaiziImageMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      prompt: 'draw sky',
      options: expect.objectContaining({ modelId: 'seedream5.0lite' }),
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
    expect(image).toMatchObject({ requestId: 'kz-image', externalId: 'KUAIZI:IMAGE:mock' })
    expect(video).toMatchObject({ requestId: 'kz-video', externalId: 'KUAIZI:VIDEO:mock' })
    expect(audio).toMatchObject({ requestId: 'kz-audio', externalId: 'KUAIZI:AUDIO:mock' })
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

    expect(generateKuaiziImageMock).not.toHaveBeenCalled()
    expect(generateKuaiziVideoMock).not.toHaveBeenCalled()
    expect(generateKuaiziAudioMock).not.toHaveBeenCalled()
  })

  it('does not execute mask editing through a retired compatible provider', async () => {
    resolveModelSelectionMock.mockResolvedValueOnce({
      provider: 'openai-compatible:oa-1',
      modelId: 'gpt-image-1',
      modelKey: 'openai-compatible:oa-1::gpt-image-1',
      mediaType: 'image',
    })

    await expect(generateImage('user-1', 'openai-compatible:oa-1::gpt-image-1', 'replace window', {
      referenceImages: ['data:image/png;base64,U09VUkNF'],
      editMode: 'inpaint',
      maskImage: 'data:image/png;base64,TUFTSw==',
    })).rejects.toThrow('MEDIA_PROVIDER_UNSUPPORTED')
    expect(generateKuaiziImageMock).not.toHaveBeenCalled()
  })
})
