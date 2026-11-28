import {
  assertOfficialModelRegistered,
  registerOfficialModel,
} from '@/lib/providers/official/model-registry'
import type { OpenLuxKeyGroup } from './groups'

export type OpenLuxModelModality = 'image' | 'llm'

export interface OpenLuxModelDefinition {
  modelId: string
  name: string
  modality: OpenLuxModelModality
  keyGroup: OpenLuxKeyGroup
  supportsVision?: boolean
  /**
   * Only models with a verified, non-zero unit price may be exposed to
   * administrators and users. Ratio-only models returned by GET /v1/models do
   * not expose a deterministic per-image price, so they stay registered but
   * not selectable until a verified price is added to the pricing catalog.
   */
  selectable: boolean
}

// Verified against live OpenLux public pricing endpoint (https://www.openlux.ai/api/pricing)
// and GET /v1/models. Every modelId matches the exact upstream OpenLux model_name.
const OPENLUX_CATALOG: readonly OpenLuxModelDefinition[] = [
  // Text / Multimodal LLMs (OpenAI /v1/chat/completions compatible)
  {
    modelId: 'gemini-3.8-flash',
    name: 'OpenLux Gemini 3.8 Flash',
    modality: 'llm',
    keyGroup: 'aistudio-gemini-3',
    supportsVision: true,
    selectable: true,
  },
  {
    modelId: 'deepseek-v4.1-flash',
    name: 'OpenLux DeepSeek V4.1 Flash',
    modality: 'llm',
    keyGroup: 'self-deployed',
    supportsVision: true,
    selectable: true,
  },
  {
    modelId: 'deepseek-v4-pro',
    name: 'OpenLux DeepSeek V4 Pro',
    modality: 'llm',
    keyGroup: 'self-deployed',
    supportsVision: true,
    selectable: true,
  },
  {
    modelId: 'qwen3.8-max',
    name: 'OpenLux Qwen 3.8 Max',
    modality: 'llm',
    keyGroup: 'self-deployed',
    supportsVision: true,
    selectable: true,
  },
  {
    modelId: 'kimi-k2.6',
    name: 'OpenLux Kimi K2.6',
    modality: 'llm',
    keyGroup: 'self-deployed',
    supportsVision: true,
    selectable: true,
  },
  {
    modelId: 'claude-sonnet-5',
    name: 'OpenLux Claude Sonnet 5',
    modality: 'llm',
    keyGroup: 'claude',
    supportsVision: true,
    selectable: true,
  },
  // Image Generation Models
  {
    modelId: 'gpt-image-2.5-flare',
    name: 'OpenLux GPT Image 2.5 Flare',
    modality: 'image',
    keyGroup: 'default',
    selectable: true,
  },
  {
    modelId: 'gpt-image-2.5-sunburst',
    name: 'OpenLux GPT Image 2.5 Sunburst',
    modality: 'image',
    keyGroup: 'default',
    selectable: true,
  },
  {
    modelId: 'gpt-image-2.5-flare-c',
    name: 'OpenLux GPT Image 2.5 Flare C',
    modality: 'image',
    keyGroup: 'default',
    selectable: true,
  },
  {
    modelId: 'gpt-image-2.5-sunburst-c',
    name: 'OpenLux GPT Image 2.5 Sunburst C',
    modality: 'image',
    keyGroup: 'default',
    selectable: true,
  },
  {
    modelId: 'gpt-image-2.6-flare',
    name: 'OpenLux GPT Image 2.6 Flare',
    modality: 'image',
    keyGroup: 'default',
    // Ratio-priced upstream; no verified flat image price yet.
    selectable: false,
  },
  {
    modelId: 'gpt-image-2.6-sunburst',
    name: 'OpenLux GPT Image 2.6 Sunburst',
    modality: 'image',
    keyGroup: 'default',
    // Ratio-priced upstream; no verified flat image price yet.
    selectable: false,
  },
  {
    modelId: 'gpt-image-2.6-flare-c',
    name: 'OpenLux GPT Image 2.6 Flare C',
    modality: 'image',
    keyGroup: 'default',
    selectable: true,
  },
  {
    modelId: 'gpt-image-2.6-sunburst-c',
    name: 'OpenLux GPT Image 2.6 Sunburst C',
    modality: 'image',
    keyGroup: 'default',
    selectable: true,
  },
]

let initialized = false

export function ensureOpenLuxCatalogRegistered(): void {
  if (initialized) return
  initialized = true
  for (const model of OPENLUX_CATALOG) {
    registerOfficialModel({
      provider: 'openlux',
      modality: model.modality,
      modelId: model.modelId,
    })
  }
}

export function listOpenLuxCatalogModels(
  modality?: OpenLuxModelModality,
  options: { selectableOnly?: boolean } = {},
): OpenLuxModelDefinition[] {
  ensureOpenLuxCatalogRegistered()
  return OPENLUX_CATALOG
    .filter((model) => !modality || model.modality === modality)
    .filter((model) => !options.selectableOnly || model.selectable)
    .map((model) => ({ ...model }))
}

export function listOpenLuxSelectableModels(
  modality?: OpenLuxModelModality,
): OpenLuxModelDefinition[] {
  return listOpenLuxCatalogModels(modality, { selectableOnly: true })
}

export function getOpenLuxModelDefinition(
  modelId: string,
  expectedModality?: OpenLuxModelModality,
): OpenLuxModelDefinition {
  ensureOpenLuxCatalogRegistered()
  const normalizedModelId = modelId.trim()
  const model = OPENLUX_CATALOG.find((item) => item.modelId === normalizedModelId)
  if (!model || expectedModality && model.modality !== expectedModality) {
    throw new Error(`MODEL_NOT_REGISTERED: openlux/${expectedModality || 'unknown'}/${normalizedModelId}`)
  }
  assertOfficialModelRegistered({
    provider: 'openlux',
    modality: model.modality,
    modelId: model.modelId,
  })
  return { ...model }
}
