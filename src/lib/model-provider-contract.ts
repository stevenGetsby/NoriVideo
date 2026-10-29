import type { UnifiedModelType } from '@/lib/model-config-contract'

export const MODEL_PROVIDER = {
  DEEPSEEK: 'deepseek',
  KUAIZI: 'kuaizi',
} as const

export type ModelProviderKey = (typeof MODEL_PROVIDER)[keyof typeof MODEL_PROVIDER]
export type ModelCapabilityGroup = 'text' | 'image' | 'video' | 'audio'

export type ModelProviderPreset = {
  id: ModelProviderKey
  name: string
  baseUrl: string
}

export type ModelPreset = {
  modelId: string
  name: string
  type: UnifiedModelType
  provider: ModelProviderKey
  capabilityGroup: ModelCapabilityGroup
}

export const MODEL_PROVIDER_PRESETS: readonly ModelProviderPreset[] = [
  { id: MODEL_PROVIDER.DEEPSEEK, name: 'DeepSeek 官方', baseUrl: 'https://api.deepseek.com/v1' },
  { id: MODEL_PROVIDER.KUAIZI, name: 'Kuaizi API', baseUrl: 'https://aiopenapi.kuaizi.cn' },
]

export const MODEL_PROVIDER_NAME_ZH: Readonly<Record<string, string>> = Object.fromEntries(
  MODEL_PROVIDER_PRESETS.map((provider) => [provider.id, provider.name]),
)

export const MODEL_PRESETS: readonly ModelPreset[] = [
  { modelId: 'deepseek-chat', name: 'DeepSeek Chat', type: 'llm', provider: MODEL_PROVIDER.DEEPSEEK, capabilityGroup: 'text' },
  { modelId: 'deepseek-reasoner', name: 'DeepSeek Reasoner', type: 'llm', provider: MODEL_PROVIDER.DEEPSEEK, capabilityGroup: 'text' },
]

export function getRawProviderKey(providerId?: string): string {
  if (!providerId) return ''
  const colonIndex = providerId.indexOf(':')
  return colonIndex === -1 ? providerId : providerId.slice(0, colonIndex)
}

export function normalizeModelProviderKey(providerId?: string): ModelProviderKey | null {
  const rawKey = getRawProviderKey(providerId).toLowerCase()
  return rawKey === MODEL_PROVIDER.DEEPSEEK || rawKey === MODEL_PROVIDER.KUAIZI ? rawKey : null
}

export function isSupportedModelProvider(providerId?: string): boolean {
  return normalizeModelProviderKey(providerId) !== null
}

export function isOpenAICompatLlmProviderId(providerId?: string): boolean {
  return normalizeModelProviderKey(providerId) === MODEL_PROVIDER.DEEPSEEK
}

export function normalizeProviderModelId(_providerId: string | undefined, modelId: string): string {
  return modelId
}

export function getModelCapabilityGroup(input: {
  provider: string
  modelId: string
  type: UnifiedModelType
}): ModelCapabilityGroup | null {
  if (input.type === 'image') return 'image'
  if (input.type === 'video') return 'video'
  if (input.type === 'audio') return 'audio'
  return input.type === 'llm' ? 'text' : null
}
