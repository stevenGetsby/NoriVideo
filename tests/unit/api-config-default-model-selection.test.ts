import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  userPreference: {
    findUnique: vi.fn(),
  },
}))

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))

vi.mock('@/lib/crypto-utils', () => ({
  decryptApiKey: vi.fn((value: string) => value),
  encryptApiKey: vi.fn((value: string) => value),
}))

import { getModelsByType, resolveModelSelection } from '@/lib/api-config'

describe('api-config default model selections', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('KUAIZI_API_KEY', 'test-kuaizi-key')
    prismaMock.userPreference.findUnique.mockResolvedValue({
      customModels: JSON.stringify([]),
      customProviders: JSON.stringify([
        {
          id: 'ark',
          name: 'Volcengine Ark',
          apiKey: 'encrypted-key',
        },
      ]),
      analysisModel: null,
      characterModel: null,
      locationModel: null,
      storyboardModel: null,
      editModel: null,
      videoModel: 'ark::doubao-seedance-1-0-pro-fast-251015',
      audioModel: null,
      lipSyncModel: null,
    })
  })

  afterEach(() => vi.unstubAllEnvs())

  it('routes a legacy video model through the administrator-controlled Seedance alias', async () => {
    await expect(resolveModelSelection(
      'user-1',
      'ark::doubao-seedance-1-0-pro-fast-251015',
      'video',
    )).resolves.toEqual({
      provider: 'kuaizi',
      modelId: 'doubao-seedance-2-0-fast-260128',
      modelKey: 'kuaizi::doubao-seedance-2-0-fast-260128',
      mediaType: 'video',
    })
  })

  it('includes the routed Seedance provider model in runtime model listing', async () => {
    const models = await getModelsByType('user-1', 'video')

    expect(models).toContainEqual(expect.objectContaining({
      provider: 'kuaizi',
      modelId: 'doubao-seedance-2-0-260128',
      modelKey: 'kuaizi::doubao-seedance-2-0-260128',
      type: 'video',
    }))
  })
})
