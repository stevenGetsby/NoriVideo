import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api-config', () => ({
  getProviderConfig: vi.fn(async () => ({ apiKey: 'test-key', baseUrl: 'https://ailink.jinghua.security' })),
}))

vi.mock('@/lib/media/outbound-image', () => ({
  normalizeReferenceImagesForGeneration: vi.fn(async (urls: string[]) => urls),
  normalizeToOriginalMediaUrl: vi.fn(async (url: string) => url),
  normalizeToPublicImageUrlForGeneration: vi.fn(async (url: string) => url),
}))

import { getAilinkModelDefinition, listAilinkCatalogModels, listAilinkSelectableModels } from '@/lib/providers/ailink/catalog'
import { decodeAilinkExternalToken, encodeAilinkExternalToken, formatAilinkExternalId } from '@/lib/providers/ailink/external-id'
import { generateAilinkVideo } from '@/lib/providers/ailink/video'
import { queryAilinkTaskStatus } from '@/lib/providers/ailink/poll'
import { fixedPlatformModels } from '@/lib/platform-services/config'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('ailink catalog', () => {
  it('registers both Seedance 2.5 variants', () => {
    expect(listAilinkCatalogModels().map((model) => model.modelId)).toEqual([
      'doubao-seedance-2-5',
      'doubao-seedance-2-5-flash',
    ])
  })

  it('limits flash to 480p and 720p', () => {
    expect(getAilinkModelDefinition('doubao-seedance-2-5-flash').resolutions).toEqual(['480p', '720p'])
  })

  it('rejects unknown model ids', () => {
    expect(() => getAilinkModelDefinition('doubao-seedance-2-0')).toThrow(/AILINK_MODEL_UNSUPPORTED/)
  })

  it('exposes the ailink models in fixed platform models only when priced', () => {
    const selectable = listAilinkSelectableModels().map((model) => model.modelId)
    const fixed = fixedPlatformModels()
      .filter((model) => model.provider === 'ailink')
      .map((model) => model.modelKey)
    expect(fixed).toEqual(selectable.map((modelId) => `ailink::${modelId}`))
    expect(selectable).toContain('doubao-seedance-2-5')
  })
})

describe('ailink external id', () => {
  it('round-trips provider and model tokens', () => {
    const externalId = formatAilinkExternalId({
      providerId: 'ailink',
      modelId: 'doubao-seedance-2-5-flash',
      taskId: 'cgt-20261125-abc',
    })
    const [namespace, type, providerToken, modelToken, taskId] = externalId.split(':')
    expect([namespace, type, taskId]).toEqual(['AILINK', 'VIDEO', 'cgt-20261125-abc'])
    expect(decodeAilinkExternalToken(providerToken)).toBe('ailink')
    expect(decodeAilinkExternalToken(modelToken)).toBe('doubao-seedance-2-5-flash')
    expect(decodeAilinkExternalToken(encodeAilinkExternalToken('ailink'))).toBe('ailink')
  })

  it('rejects invalid tokens', () => {
    expect(() => decodeAilinkExternalToken('bad token!')).toThrow(/AILINK_EXTERNAL_ID_TOKEN_INVALID/)
  })
})

describe('ailink poll status mapping', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('maps queued and running to pending', async () => {
    for (const status of ['queued', 'running']) {
      fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'cgt-1', status }))
      await expect(queryAilinkTaskStatus({ taskId: 'cgt-1', apiKey: 'k' })).resolves.toEqual({ status: 'pending' })
    }
  })

  it('maps succeeded to a completed video result with token usage', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      id: 'cgt-2',
      status: 'succeeded',
      content: { video_url: 'https://cdn.example.com/v.mp4' },
      usage: { completion_tokens: 12345, total_tokens: 12345 },
      duration: 5,
      resolution: '720p',
    }))
    const result = await queryAilinkTaskStatus({ taskId: 'cgt-2', apiKey: 'k' })
    expect(result).toMatchObject({
      status: 'completed',
      resultUrl: 'https://cdn.example.com/v.mp4',
      videoUrl: 'https://cdn.example.com/v.mp4',
      actualVideoTokens: 12345,
      durationSeconds: 5,
    })
  })

  it('maps failed to a failed result with the upstream message', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      id: 'cgt-3',
      status: 'failed',
      error: { message: 'content moderation rejected' },
    }))
    await expect(queryAilinkTaskStatus({ taskId: 'cgt-3', apiKey: 'k' })).resolves.toEqual({
      status: 'failed',
      error: 'content moderation rejected',
    })
  })

  it('sanitizes an upstream error that echoes a signed URL', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      status: 'failed',
      error: { message: 'bad asset https://ailink.jinghua.security/x?sig=secret' },
    }))
    const result = await queryAilinkTaskStatus({ taskId: 'cgt-4', apiKey: 'k' })
    expect(result.status).toBe('failed')
    expect(result.status === 'failed' && result.error).not.toContain('sig=secret')
  })
})

describe('ailink video request', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    fetchMock.mockResolvedValue(jsonResponse({ id: 'cgt-new', status: 'queued' }))
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  async function sentBody(): Promise<Record<string, unknown>> {
    const init = fetchMock.mock.calls[0][1] as RequestInit
    return JSON.parse(String(init.body)) as Record<string, unknown>
  }

  it('places generation parameters at the top level, not under metadata', async () => {
    await generateAilinkVideo({
      userId: 'u1',
      imageUrl: '',
      prompt: 'a cat',
      options: {
        provider: 'ailink',
        modelId: 'doubao-seedance-2-5',
        resolution: '1080p',
        aspectRatio: '16:9',
        duration: 6,
        generateAudio: true,
      } as never,
    })
    const body = await sentBody()
    expect(body).toMatchObject({
      model: 'doubao-seedance-2-5',
      resolution: '1080p',
      ratio: '16:9',
      duration: 6,
      generate_audio: true,
    })
    expect(body).not.toHaveProperty('metadata')
    expect(body.content).toEqual([{ type: 'text', text: 'a cat' }])
  })

  it('turns generated audio on when the caller does not choose', async () => {
    await generateAilinkVideo({
      userId: 'u1',
      imageUrl: '',
      prompt: 'a cat',
      options: { provider: 'ailink', modelId: 'doubao-seedance-2-5', duration: 5 } as never,
    })
    expect(await sentBody()).toMatchObject({ generate_audio: true })
  })

  it('defaults resolution to 720p and sends first and last frame roles', async () => {
    await generateAilinkVideo({
      userId: 'u1',
      imageUrl: 'https://img.example.com/first.png',
      prompt: 'move',
      options: {
        provider: 'ailink',
        modelId: 'doubao-seedance-2-5',
        lastFrameImageUrl: 'https://img.example.com/last.png',
      } as never,
    })
    const body = await sentBody()
    expect(body.resolution).toBe('720p')
    expect(body.content).toEqual([
      { type: 'text', text: 'move' },
      { type: 'image_url', image_url: { url: 'https://img.example.com/first.png' }, role: 'first_frame' },
      { type: 'image_url', image_url: { url: 'https://img.example.com/last.png' }, role: 'last_frame' },
    ])
  })

  it('rejects durations outside the model range', async () => {
    await expect(generateAilinkVideo({
      userId: 'u1',
      imageUrl: '',
      prompt: 'x',
      options: { provider: 'ailink', modelId: 'doubao-seedance-2-5', duration: 3 } as never,
    })).rejects.toThrow(/AILINK_VIDEO_DURATION_UNSUPPORTED/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects 1080p on the flash variant', async () => {
    await expect(generateAilinkVideo({
      userId: 'u1',
      imageUrl: '',
      prompt: 'x',
      options: { provider: 'ailink', modelId: 'doubao-seedance-2-5-flash', resolution: '1080p' } as never,
    })).rejects.toThrow(/AILINK_VIDEO_RESOLUTION_UNSUPPORTED/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns an ailink external id for the created task', async () => {
    const result = await generateAilinkVideo({
      userId: 'u1',
      imageUrl: '',
      prompt: 'x',
      options: { provider: 'ailink', modelId: 'doubao-seedance-2-5-flash' } as never,
    })
    expect(result).toMatchObject({ success: true, async: true, requestId: 'cgt-new' })
    expect(String(result.externalId)).toMatch(/^AILINK:VIDEO:/)
    expect(String(result.externalId).endsWith(':cgt-new')).toBe(true)
  })
})
