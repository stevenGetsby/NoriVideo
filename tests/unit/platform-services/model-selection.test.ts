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
      { provider: 'kuaizi', modelId: 'doubao-seedance-2-5-260628', modelKey: 'kuaizi::doubao-seedance-2-5-260628', name: 'wrong type', type: 'image' },
      { provider: 'kuaizi', modelId: 'not-in-catalog', modelKey: 'kuaizi::not-in-catalog', name: 'unknown', type: 'video' },
      { provider: 'deepseek', modelId: 'deepseek-chat', modelKey: 'deepseek::deepseek-chat', name: 'text model', type: 'llm' },
      { provider: 'openlux', modelId: 'gpt-image-2.5-sunburst', modelKey: 'openlux::gpt-image-2.5-sunburst', name: 'no credentials', type: 'image' },
    ],
    defaultModels: {},
    businessModels: [],
    modelRouting: {} as PlatformServiceConfigResponse['modelRouting'],
    storage: { type: 'tos', endpoint: '', publicEndpoint: '', region: '', bucket: '', forcePathStyle: false, hasAccessKey: false, hasSecretKey: false },
  }
}

describe('configured selectable model catalog', () => {
  it('returns actual model ids only when credentials, capabilities and pricing exist', () => {
    expect(listConfiguredSelectableModels(config(), 'video')).toEqual([{
      modelKey: 'kuaizi::doubao-seedance-2-5-260628',
      modelId: 'doubao-seedance-2-5-260628',
      name: 'doubao-seedance-2-5-260628',
      type: 'video',
    }])
    expect(listConfiguredSelectableModels(config(), 'image')).toEqual([])
    expect(listConfiguredSelectableModels(config(), 'llm')).toEqual([{
      modelKey: 'deepseek::deepseek-chat',
      modelId: 'deepseek-chat',
      name: 'deepseek-chat',
      type: 'llm',
    }])
  })
})
