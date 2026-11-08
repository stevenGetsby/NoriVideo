import { findBuiltinCapabilities } from '@/lib/model-capabilities/catalog'
import { composeModelKey, type UnifiedModelType } from '@/lib/model-config-contract'
import { findBuiltinPricingCatalogEntry } from '@/lib/model-pricing/catalog'
import type { PlatformServiceConfigResponse } from './config'

export type SelectableModelType = Extract<UnifiedModelType, 'llm' | 'image' | 'video' | 'audio'>

export function listConfiguredSelectableModels(
  config: PlatformServiceConfigResponse,
  type: SelectableModelType,
) {
  const providers = new Map(config.providers.map((provider) => [provider.id, provider.hasApiKey]))
  return config.models.filter((model) => (
    model.type === type
    && providers.get(model.provider) === true
    && (type === 'llm' || Boolean(findBuiltinCapabilities(type, model.provider, model.modelId)))
    && (type === 'llm' || Boolean(findBuiltinPricingCatalogEntry(
      type === 'audio' ? 'voice' : type,
      model.provider,
      model.modelId,
    )))
  )).map((model) => ({
    modelKey: composeModelKey(model.provider, model.modelId),
    modelId: model.modelId,
    name: model.modelId,
    type,
  }))
}
