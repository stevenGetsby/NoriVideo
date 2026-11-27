import { describe, expect, it } from 'vitest'
import { listConfiguredSelectableModels } from '@/lib/platform-services/model-selection'
import type { PlatformServiceConfigResponse } from '@/lib/platform-services/config'

function config(modelEnabled: Record<string, boolean>, withKey = true): PlatformServiceConfigResponse {
  return {
    providers: [{ id: 'topenrouter', name: 'TopenRouter', hasApiKey: withKey }, { id: 'kuaizi', name: 'Kuaizi', hasApiKey: true }],
    models: [
      { modelId: 'doubao-seedance-2-5-260628', name: 'a', type: 'video', provider: 'topenrouter' },
      { modelId: 'doubao-seedance-2-5-260628', name: 'b', type: 'video', provider: 'kuaizi' },
    ],
    businessModels: [],
    modelRouting: {},
    modelEnabled,
  } as unknown as PlatformServiceConfigResponse
}

describe('video model admin toggles', () => {
  it('lists only enabled models whose provider has a key, using provider keys directly', () => {
    const models = listConfiguredSelectableModels(config({
      'topenrouter::doubao-seedance-2-5-260628': true,
      'kuaizi::doubao-seedance-2-5-260628': false,
    }), 'video')
    expect(models.map((model) => model.modelKey)).toEqual(['topenrouter::doubao-seedance-2-5-260628'])
  })

  it('hides enabled models when the provider key is missing', () => {
    expect(listConfiguredSelectableModels(config({ 'topenrouter::doubao-seedance-2-5-260628': true }, false), 'video')).toEqual([])
  })
})
