import {
  assertOfficialModelRegistered,
  registerOfficialModel,
} from '@/lib/providers/official/model-registry'
import type { KuaiziModelDefinition, KuaiziModelModality } from './types'

const KUAIZI_CATALOG: readonly KuaiziModelDefinition[] = [
  { modelId: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', modality: 'llm', family: 'chat' },
  { modelId: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', modality: 'llm', family: 'chat' },
  { modelId: 'gpt-5.5', name: 'GPT-5.5', modality: 'llm', family: 'chat' },

  { modelId: 'kz_gpt_image2', name: 'Kuaizi GPT Image 2', modality: 'image', family: 'gpt-image' },
  { modelId: 'seedream5.0lite', name: 'Seedream 5.0 Lite', modality: 'image', family: 'seedream' },
  { modelId: 'seedream5.0pro', name: 'Seedream 5.0 Pro', modality: 'image', family: 'seedream' },

  { modelId: 'kling-v3-omni', name: 'Kling V3 Omni', modality: 'video', family: 'kling' },
  { modelId: 'happyhorse-1.0-r2v', name: 'HappyHorse 1.0 R2V', modality: 'video', family: 'happyhorse' },
  { modelId: 'happyhorse-1.0-i2v', name: 'HappyHorse 1.0 I2V', modality: 'video', family: 'happyhorse' },
  { modelId: 'happyhorse-1.0-t2v', name: 'HappyHorse 1.0 T2V', modality: 'video', family: 'happyhorse' },
  { modelId: 'happyhorse-1.0-video-edit', name: 'HappyHorse 1.0 Video Edit', modality: 'video', family: 'happyhorse' },
  { modelId: 'doubao-seedance-2-0-260128', name: 'Seedance 2.0 (Kuaizi)', modality: 'video', family: 'seedance' },
  { modelId: 'doubao-seedance-2-0-fast-260128', name: 'Seedance 2.0 Fast (Kuaizi)', modality: 'video', family: 'seedance' },
  { modelId: 'doubao-seedance-2-0-mini-260615', name: 'Seedance 2.0 Mini (Kuaizi)', modality: 'video', family: 'seedance' },

  { modelId: 'seed-audio', name: 'Seed Audio', modality: 'audio', family: 'seed-audio' },
  { modelId: 'speech-2.8-hd', name: 'MiniMax Speech 2.8 HD', modality: 'audio', family: 'minimax-tts' },
  { modelId: 'speech-2.8-turbo', name: 'MiniMax Speech 2.8 Turbo', modality: 'audio', family: 'minimax-tts' },
  { modelId: 'speech-2.6-hd', name: 'MiniMax Speech 2.6 HD', modality: 'audio', family: 'minimax-tts' },
  { modelId: 'speech-2.6-turbo', name: 'MiniMax Speech 2.6 Turbo', modality: 'audio', family: 'minimax-tts' },
  { modelId: 'speech-02-hd', name: 'MiniMax Speech 02 HD', modality: 'audio', family: 'minimax-tts' },
  { modelId: 'speech-02-turbo', name: 'MiniMax Speech 02 Turbo', modality: 'audio', family: 'minimax-tts' },
  { modelId: 'speech-01-hd', name: 'MiniMax Speech 01 HD', modality: 'audio', family: 'minimax-tts' },
  { modelId: 'speech-01-turbo', name: 'MiniMax Speech 01 Turbo', modality: 'audio', family: 'minimax-tts' },
]

let initialized = false

export function ensureKuaiziCatalogRegistered(): void {
  if (initialized) return
  initialized = true
  for (const model of KUAIZI_CATALOG) {
    registerOfficialModel({
      provider: 'kuaizi',
      modality: model.modality,
      modelId: model.modelId,
    })
  }
}

export function listKuaiziCatalogModels(modality?: KuaiziModelModality): KuaiziModelDefinition[] {
  ensureKuaiziCatalogRegistered()
  return KUAIZI_CATALOG
    .filter((model) => !modality || model.modality === modality)
    .map((model) => ({ ...model }))
}

export function getKuaiziModelDefinition(
  modelId: string,
  expectedModality?: KuaiziModelModality,
): KuaiziModelDefinition {
  ensureKuaiziCatalogRegistered()
  const normalizedModelId = modelId.trim()
  const model = KUAIZI_CATALOG.find((item) => item.modelId === normalizedModelId)
  if (!model || expectedModality && model.modality !== expectedModality) {
    throw new Error(`MODEL_NOT_REGISTERED: kuaizi/${expectedModality || 'unknown'}/${normalizedModelId}`)
  }
  assertOfficialModelRegistered({
    provider: 'kuaizi',
    modality: model.modality,
    modelId: model.modelId,
  })
  return { ...model }
}
