import { getRawProviderKey } from '@/lib/model-provider-contract'
import type { ServiceConfigModel, ServiceConfigProvider } from '@/lib/service-config'
import { isUsableServiceSecret, readMaterializedPlatformServiceConfig } from './config'
import { listKuaiziCatalogModels } from '@/lib/providers/kuaizi/catalog'

const MAX_DISCOVERED_MODELS = 500
const NON_TEXT_MODEL_PATTERN = /(?:embedding|rerank|image|video|audio|speech|whisper|tts|dall[._-]?e)/i

export interface DiscoveredProviderModels {
  providerId: string
  availableCount: number
  models: ServiceConfigModel[]
}

function compact(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function providerModelsUrl(provider: ServiceConfigProvider): string {
  if (getRawProviderKey(provider.id).toLowerCase() === 'ark') {
    return 'https://ark.cn-beijing.volces.com/api/v3/models'
  }
  const baseUrl = compact(provider.baseUrl).replace(/\/+$/, '')
  if (!baseUrl) throw new Error(`服务 ${provider.id} 未配置 Base URL`)
  return `${baseUrl}/models`
}

function modelIdsFromPayload(payload: unknown): string[] {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return []
  const record = payload as { data?: unknown; models?: unknown }
  const list = Array.isArray(record.data) ? record.data : Array.isArray(record.models) ? record.models : []
  const ids = list
    .map((item) => {
      if (typeof item === 'string') return compact(item)
      if (!item || typeof item !== 'object' || Array.isArray(item)) return ''
      return compact((item as { id?: unknown; modelId?: unknown }).id)
        || compact((item as { id?: unknown; modelId?: unknown }).modelId)
    })
    .filter(Boolean)
  return Array.from(new Set(ids)).slice(0, MAX_DISCOVERED_MODELS)
}

export function isDiscoverableTextModel(providerId: string, modelId: string): boolean {
  const provider = getRawProviderKey(providerId).toLowerCase()
  const normalized = compact(modelId)
  if (!normalized || NON_TEXT_MODEL_PATTERN.test(normalized)) return false
  if (provider === 'ghc') return /^(?:gpt|gemini)(?:[-_.]|$)/i.test(normalized)
  if (provider === 'deepseek') return /^deepseek(?:[-_.]|$)/i.test(normalized)
  return true
}

function discoveredModel(providerId: string, modelId: string): ServiceConfigModel {
  const provider = getRawProviderKey(providerId).toLowerCase()
  return {
    provider: providerId,
    modelId,
    modelKey: `${providerId}::${modelId}`,
    name: modelId,
    type: 'llm',
    llmProtocol: provider === 'ghc' ? 'responses' : 'chat-completions',
  }
}

export async function discoverProviderTextModels(providerId: string): Promise<DiscoveredProviderModels> {
  const normalizedProviderId = compact(providerId)
  const config = readMaterializedPlatformServiceConfig()
  const provider = (config.llm?.providers || []).find((item) => item.id === normalizedProviderId)
  if (!provider) throw new Error('服务不存在')
  if (!isUsableServiceSecret(provider.apiKey)) {
    throw new Error('API Key 未配置，请先保存真实密钥')
  }

  if (getRawProviderKey(provider.id).toLowerCase() === 'kuaizi') {
    const models = listKuaiziCatalogModels().map((model): ServiceConfigModel => ({
      provider: provider.id,
      modelId: model.modelId,
      modelKey: `${provider.id}::${model.modelId}`,
      name: model.name,
      type: model.modality,
    }))
    return {
      providerId: provider.id,
      availableCount: models.length,
      models,
    }
  }

  const response = await fetch(providerModelsUrl(provider), {
    headers: { Authorization: `Bearer ${provider.apiKey}` },
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error(`模型列表请求失败（HTTP ${response.status}）`)

  const payload = await response.json().catch(() => null)
  const availableModelIds = modelIdsFromPayload(payload)
  const models = availableModelIds
    .filter((modelId) => isDiscoverableTextModel(provider.id, modelId))
    .map((modelId) => discoveredModel(provider.id, modelId))

  return {
    providerId: provider.id,
    availableCount: availableModelIds.length,
    models,
  }
}
