import { describe, expect, it } from 'vitest'
import type { PlatformServiceConfigResponse } from '@/lib/platform-services/config'
import { listConfiguredSelectableModels } from '@/lib/platform-services/model-selection'

function config(): PlatformServiceConfigResponse {
  return {
    sourceFile: 'fixture.json',
    updatedAt: null,
    providers: [
      { id: 'kuaizi', name: 'provider', hasApiKey: true },
      { id: 'deepseek', name: 'provider', hasApiKey: true },
      { id: 'openlux', name: 'provider', hasApiKey: false },
    ],
    models: [
      { provider: 'kuaizi', modelId: 'doubao-seedance-2-5-260628', modelKey: 'kuaizi::doubao-seedance-2-5-260628', name: 'packaged alias', type: 'video' },
      { provider: 'kuaizi', modelId: 'wrong-type', modelKey: 'kuaizi::wrong-type', name: 'wrong type', type: 'image' },
      { provider: 'kuaizi', modelId: 'not-in-catalog', modelKey: 'kuaizi::not-in-catalog', name: 'unknown', type: 'video' },
      { provider: 'deepseek', modelId: 'deepseek-chat', modelKey: 'deepseek::deepseek-chat', name: 'text model', type: 'llm' },
      { provider: 'openlux', modelId: 'gpt-image-2.5-sunburst', modelKey: 'openlux::gpt-image-2.5-sunburst', name: 'no credentials', type: 'image' },
    ],
    defaultModels: {},
    businessModels: [
      { key: 'nori::norivideo2.5', name: 'LanMiaoTV 2.5', description: '', type: 'video', tier: 'pro' },
      { key: 'nori::seedance2.0', name: 'seedance2.0-pro', description: '', type: 'video', tier: 'pro' },
      { key: 'nori::nori-image', name: 'nori-image', description: '', type: 'image', tier: 'standard' },
      { key: 'nori::nori-gpt', name: 'nori-gpt', description: '', type: 'llm', tier: 'standard' },
      { key: 'nori::nori-gpt-max', name: 'nori-gpt-max', description: '', type: 'llm', tier: 'pro' },
    ],
    modelRouting: {
      'nori::norivideo2.5': 'kuaizi::doubao-seedance-2-5-260628',
      'nori::seedance2.0': 'kuaizi::doubao-seedance-2-5-260628',
      'nori::nori-image': 'openlux::gpt-image-2.5-sunburst',
      'nori::nori-gpt': 'deepseek::deepseek-chat',
      'nori::nori-gpt-max': '',
    } as PlatformServiceConfigResponse['modelRouting'],
    storage: { type: 'tos', endpoint: '', publicEndpoint: '', region: '', bucket: '', forcePathStyle: false, hasAccessKey: false, hasSecretKey: false },
  }
}

describe('configured selectable model catalog', () => {
  it('mirrors enabled admin capabilities, including capabilities sharing one upstream', () => {
    expect(listConfiguredSelectableModels(config(), 'video')).toEqual([
      {
        modelKey: 'nori::norivideo2.5',
        modelId: 'doubao-seedance-2-5-260628',
        name: 'doubao-seedance-2-5-260628',
        type: 'video',
        runtimeModelKey: 'kuaizi::doubao-seedance-2-5-260628',
      },
      {
        modelKey: 'nori::seedance2.0',
        modelId: 'doubao-seedance-2-5-260628',
        name: 'doubao-seedance-2-5-260628',
        type: 'video',
        runtimeModelKey: 'kuaizi::doubao-seedance-2-5-260628',
      },
    ])
    expect(listConfiguredSelectableModels(config(), 'image')).toEqual([])
    expect(listConfiguredSelectableModels(config(), 'llm')).toEqual([{
      modelKey: 'nori::nori-gpt',
      modelId: 'deepseek-chat',
      name: 'deepseek-chat',
      type: 'llm',
      runtimeModelKey: 'deepseek::deepseek-chat',
    }])
  })

  it('does not expose an upstream model that has no enabled admin route', () => {
    const next = config()
    next.modelRouting['nori::norivideo2.5'] = ''
    next.modelRouting['nori::seedance2.0'] = ''
    expect(listConfiguredSelectableModels(next, 'video')).toEqual([])
  })
})
