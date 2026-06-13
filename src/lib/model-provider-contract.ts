import {
  HFSY_IMAGE_MODEL_ID,
  HFSY_TEXT_MODEL_ID,
  HFSY_VIDEO_MODEL_ID,
} from '@/lib/hfsy-fixed-models'
import {
  LUMINA_ANTHROPIC_COMPATIBLE_MODELS,
  isLuminaAnthropicCompatibleVisionCapableModel,
  normalizeLuminaAnthropicCompatibleModelId,
} from '@/lib/lumina-anthropic-compatible-models'
import type { UnifiedModelType } from '@/lib/model-config-contract'

export const MODEL_PROVIDER = {
  LUMINA: 'lumina',
  ARK: 'ark',
  HFSY: 'hfsy',
} as const

export type ModelProviderKey = (typeof MODEL_PROVIDER)[keyof typeof MODEL_PROVIDER]
export type ModelCapabilityGroup = 'text' | 'vision' | 'image' | 'video'

export type ModelProviderPreset = {
  id: ModelProviderKey
  name: string
  baseUrl?: string
}

export type ModelPreset = {
  modelId: string
  name: string
  type: UnifiedModelType
  provider: ModelProviderKey
  capabilityGroup: ModelCapabilityGroup
}

const PROVIDER_KEY_ALIASES: Readonly<Record<string, ModelProviderKey>> = {
  lumina: MODEL_PROVIDER.LUMINA,
  'anthropic-compatible': MODEL_PROVIDER.LUMINA,
  ark: MODEL_PROVIDER.ARK,
  hfsy: MODEL_PROVIDER.HFSY,
  'openai-compatible': MODEL_PROVIDER.HFSY,
}

export const MODEL_PROVIDER_PRESETS: readonly ModelProviderPreset[] = [
  { id: MODEL_PROVIDER.LUMINA, name: 'Lumina', baseUrl: 'https://lumina.tripo3d.com/' },
  { id: MODEL_PROVIDER.ARK, name: 'Volcengine Ark' },
  { id: MODEL_PROVIDER.HFSY, name: 'HFSY API', baseUrl: 'https://www.hfsyapi.cn/v1' },
]

export const MODEL_PROVIDER_NAME_ZH: Readonly<Record<ModelProviderKey, string>> = {
  lumina: 'Lumina',
  ark: '火山引擎 Ark',
  hfsy: 'HFSY API',
}

const ARK_TEXT_MODELS: ModelPreset[] = [
  { modelId: 'doubao-seed-1-8-251228', name: 'Doubao Seed 1.8', type: 'llm', provider: MODEL_PROVIDER.ARK, capabilityGroup: 'text' },
  { modelId: 'doubao-seed-2-0-pro-260215', name: 'Doubao Seed 2.0 Pro', type: 'llm', provider: MODEL_PROVIDER.ARK, capabilityGroup: 'text' },
  { modelId: 'doubao-seed-2-0-lite-260215', name: 'Doubao Seed 2.0 Lite', type: 'llm', provider: MODEL_PROVIDER.ARK, capabilityGroup: 'text' },
  { modelId: 'doubao-seed-2-0-mini-260215', name: 'Doubao Seed 2.0 Mini', type: 'llm', provider: MODEL_PROVIDER.ARK, capabilityGroup: 'text' },
  { modelId: 'doubao-seed-1-6-251015', name: 'Doubao Seed 1.6', type: 'llm', provider: MODEL_PROVIDER.ARK, capabilityGroup: 'text' },
  { modelId: 'doubao-seed-1-6-lite-251015', name: 'Doubao Seed 1.6 Lite', type: 'llm', provider: MODEL_PROVIDER.ARK, capabilityGroup: 'text' },
]

const ARK_IMAGE_MODELS: ModelPreset[] = [
  { modelId: 'doubao-seedream-4-5-251128', name: 'Seedream 4.5', type: 'image', provider: MODEL_PROVIDER.ARK, capabilityGroup: 'image' },
  { modelId: 'doubao-seedream-4-0-250828', name: 'Seedream 4.0', type: 'image', provider: MODEL_PROVIDER.ARK, capabilityGroup: 'image' },
  { modelId: 'doubao-seedream-5-0-260128', name: 'Seedream 5.0 Lite', type: 'image', provider: MODEL_PROVIDER.ARK, capabilityGroup: 'image' },
]

const ARK_VIDEO_MODELS: ModelPreset[] = [
  { modelId: 'doubao-seedance-1-0-pro-fast-251015', name: 'Seedance 1.0 Pro Fast', type: 'video', provider: MODEL_PROVIDER.ARK, capabilityGroup: 'video' },
  { modelId: 'doubao-seedance-1-0-lite-i2v-250428', name: 'Seedance 1.0 Lite', type: 'video', provider: MODEL_PROVIDER.ARK, capabilityGroup: 'video' },
  { modelId: 'doubao-seedance-1-5-pro-251215', name: 'Seedance 1.5 Pro', type: 'video', provider: MODEL_PROVIDER.ARK, capabilityGroup: 'video' },
  { modelId: 'doubao-seedance-2-0-260128', name: 'Seedance 2.0', type: 'video', provider: MODEL_PROVIDER.ARK, capabilityGroup: 'video' },
  { modelId: 'doubao-seedance-2-0-fast-260128', name: 'Seedance 2.0 Fast', type: 'video', provider: MODEL_PROVIDER.ARK, capabilityGroup: 'video' },
  { modelId: 'doubao-seedance-1-0-pro-250528', name: 'Seedance 1.0 Pro', type: 'video', provider: MODEL_PROVIDER.ARK, capabilityGroup: 'video' },
]

export const MODEL_PRESETS: readonly ModelPreset[] = [
  ...LUMINA_ANTHROPIC_COMPATIBLE_MODELS.map((model): ModelPreset => ({
    modelId: model.modelId,
    name: model.name,
    type: 'llm',
    provider: MODEL_PROVIDER.LUMINA,
    capabilityGroup: model.group === 'vision' ? 'vision' : 'text',
  })),
  ...ARK_TEXT_MODELS,
  ...ARK_IMAGE_MODELS,
  ...ARK_VIDEO_MODELS,
  { modelId: HFSY_TEXT_MODEL_ID, name: 'HFSY GPT 5.5', type: 'llm', provider: MODEL_PROVIDER.HFSY, capabilityGroup: 'text' },
  { modelId: HFSY_IMAGE_MODEL_ID, name: 'HFSY GPT Image 2', type: 'image', provider: MODEL_PROVIDER.HFSY, capabilityGroup: 'image' },
  { modelId: HFSY_VIDEO_MODEL_ID, name: 'HFSY SD 2 VIP', type: 'video', provider: MODEL_PROVIDER.HFSY, capabilityGroup: 'video' },
]

export function getRawProviderKey(providerId?: string): string {
  if (!providerId) return ''
  const colonIndex = providerId.indexOf(':')
  return colonIndex === -1 ? providerId : providerId.slice(0, colonIndex)
}

export function normalizeModelProviderKey(providerId?: string): ModelProviderKey | null {
  const rawKey = getRawProviderKey(providerId).toLowerCase()
  return PROVIDER_KEY_ALIASES[rawKey] ?? null
}

export function isSupportedModelProvider(providerId?: string): boolean {
  return normalizeModelProviderKey(providerId) !== null
}

export function isLuminaProviderId(providerId?: string): boolean {
  return normalizeModelProviderKey(providerId) === MODEL_PROVIDER.LUMINA
}

export function isHfsyProviderId(providerId?: string): boolean {
  return normalizeModelProviderKey(providerId) === MODEL_PROVIDER.HFSY
}

export function normalizeProviderModelId(providerId: string | undefined, modelId: string): string {
  return isLuminaProviderId(providerId)
    ? normalizeLuminaAnthropicCompatibleModelId(modelId)
    : modelId
}

export function getModelCapabilityGroup(input: {
  provider: string
  modelId: string
  type: UnifiedModelType
}): ModelCapabilityGroup | null {
  if (input.type === 'image') return 'image'
  if (input.type === 'video') return 'video'
  if (input.type !== 'llm') return null

  if (
    isLuminaProviderId(input.provider)
    && isLuminaAnthropicCompatibleVisionCapableModel(input.modelId)
  ) {
    return 'vision'
  }
  return 'text'
}
