import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/platform-services/config', () => ({
  isUsableServiceSecret: vi.fn(() => true),
  readMaterializedPlatformServiceConfig: vi.fn(() => ({
    llm: {
      providers: [{
        id: 'kuaizi',
        name: 'Kuaizi',
        baseUrl: 'https://aiopenapi.kuaizi.cn',
        apiKey: 'test-key',
      }],
    },
  })),
}))

import { discoverProviderTextModels } from '@/lib/platform-services/discovery'

describe('kuaizi model discovery', () => {
  it('syncs every documented modality with the correct type', async () => {
    const discovered = await discoverProviderTextModels('kuaizi')

    expect(discovered.availableCount).toBe(24)
    expect(discovered.models.filter((model) => model.type === 'llm')).toHaveLength(3)
    expect(discovered.models.filter((model) => model.type === 'image')).toHaveLength(3)
    expect(discovered.models.filter((model) => model.type === 'video')).toHaveLength(9)
    expect(discovered.models.filter((model) => model.type === 'audio')).toHaveLength(9)
    expect(discovered.models).toEqual(expect.arrayContaining([
      expect.objectContaining({ modelId: 'deepseek-v4-pro', type: 'llm' }),
      expect.objectContaining({ modelId: 'doubao-seedance-2-5-260628', type: 'video' }),
      expect.objectContaining({ modelId: 'seedream5.0pro', type: 'image' }),
      expect.objectContaining({ modelId: 'doubao-seedance-2-0-fast-260128', type: 'video' }),
      expect.objectContaining({ modelId: 'doubao-seedance-2-0-mini-260615', type: 'video' }),
      expect.objectContaining({ modelId: 'speech-2.8-hd', type: 'audio' }),
    ]))
  })
})
