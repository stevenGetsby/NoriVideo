import { beforeEach, describe, expect, it, vi } from 'vitest'

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
}))

import { getModelsByType, resolveModelSelection } from '@/lib/api-config'

describe('api-config default model selections', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

  it('treats user default video model as an enabled runtime model', async () => {
    await expect(resolveModelSelection(
      'user-1',
      'ark::doubao-seedance-1-0-pro-fast-251015',
      'video',
    )).resolves.toEqual({
      provider: 'ark',
      modelId: 'doubao-seedance-1-0-pro-fast-251015',
      modelKey: 'ark::doubao-seedance-1-0-pro-fast-251015',
      mediaType: 'video',
    })
  })

  it('includes user default video model in runtime model listing', async () => {
    const models = await getModelsByType('user-1', 'video')

    expect(models).toEqual([
      expect.objectContaining({
        provider: 'ark',
        modelId: 'doubao-seedance-1-0-pro-fast-251015',
        modelKey: 'ark::doubao-seedance-1-0-pro-fast-251015',
        type: 'video',
      }),
    ])
  })
})
