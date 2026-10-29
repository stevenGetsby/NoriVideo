import { beforeEach, describe, expect, it, vi } from 'vitest'

const resolveModelSelectionMock = vi.hoisted(() => vi.fn())
const generateKuaiziMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api-config', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/api-config')>(),
  resolveModelSelection: resolveModelSelectionMock,
}))
vi.mock('@/lib/providers/kuaizi', () => ({
  generateKuaiziImage: generateKuaiziMock,
  generateKuaiziVideo: generateKuaiziMock,
  generateKuaiziAudio: vi.fn(),
}))

import { generateImage, generateVideo } from '@/lib/generator-api'

describe('retired OpenAI-compatible media execution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn())
  })

  it.each([
    { modelId: 'gpt-image-1', type: 'image' as const },
    { modelId: 'veo3.1', type: 'video' as const },
  ])('rejects $type even when a legacy media template is present', async ({ modelId, type }) => {
    resolveModelSelectionMock.mockResolvedValueOnce({
      provider: 'openai-compatible:oa-1',
      modelId,
      modelKey: `openai-compatible:oa-1::${modelId}`,
      mediaType: type,
      compatMediaTemplate: { version: 1, mediaType: type },
    })
    const pending = type === 'image'
      ? generateImage('user-1', `openai-compatible:oa-1::${modelId}`, 'draw')
      : generateVideo('user-1', `openai-compatible:oa-1::${modelId}`, '', { prompt: 'animate' })
    await expect(pending).rejects.toThrow('MEDIA_PROVIDER_UNSUPPORTED')
    expect(generateKuaiziMock).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })
})
