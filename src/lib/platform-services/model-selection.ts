import type { NoriBusinessModelType } from '@/lib/nori-model-catalog'
import { composeModelKey } from '@/lib/model-config-contract'
import type { PlatformServiceConfigResponse } from './config'

export type SelectableModelType = NoriBusinessModelType

export interface ConfiguredSelectableModel {
  modelKey: string
  modelId: string
  name: string
  type: SelectableModelType
  runtimeModelKey: string
}

export function listConfiguredSelectableModels(
  config: PlatformServiceConfigResponse,
  type: SelectableModelType,
): ConfiguredSelectableModel[] {
  const providers = new Map(config.providers.map((provider) => [provider.id, provider.hasApiKey]))
  const models = new Map(config.models.map((model) => [composeModelKey(model.provider, model.modelId), model]))
  return config.businessModels.filter((business) => {
    if (business.type !== type) return false
    const runtimeModelKey = config.modelRouting[business.key as keyof typeof config.modelRouting]
    const runtime = runtimeModelKey ? models.get(runtimeModelKey) : null
    return runtime?.type === type && providers.get(runtime.provider) === true
  }).map((business) => {
    const runtimeModelKey = config.modelRouting[business.key as keyof typeof config.modelRouting]
    return {
      modelKey: business.key,
      modelId: runtimeModelKey.split('::').slice(1).join('::'),
      name: runtimeModelKey.split('::').slice(1).join('::'),
      type,
      runtimeModelKey,
    }
  })
}
