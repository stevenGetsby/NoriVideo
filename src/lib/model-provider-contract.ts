import type { UnifiedModelType } from '@/lib/model-config-contract'

export const MODEL_PROVIDER = {
  OPENLUX: 'openlux',
  KUAIZI: 'kuaizi',
  HUIMENGI: 'huimengi',
  AILINK: 'ailink',
  TOPENROUTER: 'topenrouter',
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
  { id: MODEL_PROVIDER.OPENLUX, name: 'OpenLux API', baseUrl: 'https://api.openlux.ai/v1' },
  { id: MODEL_PROVIDER.KUAIZI, name: 'Kuaizi API', baseUrl: 'https://aiopenapi.kuaizi.cn' },
  { id: MODEL_PROVIDER.HUIMENGI, name: '绘梦工坊 API', baseUrl: 'https://api.huimengi.com' },
  { id: MODEL_PROVIDER.AILINK, name: 'AILink API', baseUrl: 'https://ailink.jinghua.security' },
  { id: MODEL_PROVIDER.TOPENROUTER, name: 'TopenRouter API', baseUrl: 'https://tp-api.chinadatapay.com:8000' },
]

export const MODEL_PROVIDER_NAME_ZH: Readonly<Record<string, string>> = Object.fromEntries(
  MODEL_PROVIDER_PRESETS.map((provider) => [provider.id, provider.name]),
)

export const MODEL_PRESETS: readonly ModelPreset[] = [
  { modelId: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', type: 'llm', provider: MODEL_PROVIDER.OPENLUX, capabilityGroup: 'text' },
  { modelId: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash', type: 'llm', provider: MODEL_PROVIDER.OPENLUX, capabilityGroup: 'text' },
  { modelId: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', type: 'llm', provider: MODEL_PROVIDER.OPENLUX, capabilityGroup: 'text' },
  { modelId: 'qwen3.8-max', name: 'Qwen 3.8 Max', type: 'llm', provider: MODEL_PROVIDER.OPENLUX, capabilityGroup: 'text' },
  { modelId: 'kimi-k2.6', name: 'Kimi K2.6', type: 'llm', provider: MODEL_PROVIDER.OPENLUX, capabilityGroup: 'text' },
  { modelId: 'claude-sonnet-5', name: 'Claude Sonnet 5', type: 'llm', provider: MODEL_PROVIDER.OPENLUX, capabilityGroup: 'text' },
  { modelId: 'gpt-image-2.5-flare', name: 'GPT Image 2.5 Flare', type: 'image', provider: MODEL_PROVIDER.OPENLUX, capabilityGroup: 'image' },
  { modelId: 'gpt-image-2.5-sunburst', name: 'GPT Image 2.5 Sunburst', type: 'image', provider: MODEL_PROVIDER.OPENLUX, capabilityGroup: 'image' },
]

export function getRawProviderKey(providerId?: string): string {
  if (!providerId) return ''
  const colonIndex = providerId.indexOf(':')
  return colonIndex === -1 ? providerId : providerId.slice(0, colonIndex)
}

export function normalizeModelProviderKey(providerId?: string): ModelProviderKey | null {
  const rawKey = getRawProviderKey(providerId).toLowerCase()
  return rawKey === MODEL_PROVIDER.OPENLUX
    || rawKey === MODEL_PROVIDER.KUAIZI
    || rawKey === MODEL_PROVIDER.HUIMENGI
    || rawKey === MODEL_PROVIDER.AILINK
    || rawKey === MODEL_PROVIDER.TOPENROUTER
    ? rawKey
    : null
}

export function isSupportedModelProvider(providerId?: string): boolean {
  return normalizeModelProviderKey(providerId) !== null
}

export function isOpenAICompatLlmProviderId(providerId?: string): boolean {
  return normalizeModelProviderKey(providerId) === MODEL_PROVIDER.OPENLUX
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
