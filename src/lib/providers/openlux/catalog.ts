import {
  assertOfficialModelRegistered,
  registerOfficialModel,
} from '@/lib/providers/official/model-registry'

export type OpenLuxModelModality = 'image'

export interface OpenLuxModelDefinition {
  modelId: string
  name: string
  modality: OpenLuxModelModality
  /**
   * Only models with a verified, non-zero unit price may be exposed to
   * administrators and users. Ratio-only models returned by GET /v1/models do
   * not expose a deterministic per-image price, so they stay registered but
   * not selectable until a verified price is added to the pricing catalog.
   */
  selectable: boolean
}

// Verified with a read-only GET /v1/models against the protected platform
// service configuration on 2026-11-08. Every entry below was returned by the
// provider; no model id was inferred from a naming pattern.
// Pricing verified on the same day against the public OpenLux pricing endpoint:
// the `-c` variants expose a fixed per-image model_price of 0.16, while the
// non-`-c` 2.6 variants are ratio-priced (model_price 0, model_ratio 2.5) and
// stay unselectable until a deterministic per-image price is published.
const OPENLUX_CATALOG: readonly OpenLuxModelDefinition[] = [
  {
    modelId: 'gpt-image-2.5-flare',
    name: 'OpenLux GPT Image 2.5 Flare',
    modality: 'image',
    selectable: true,
  },
  {
    modelId: 'gpt-image-2.5-sunburst',
    name: 'OpenLux GPT Image 2.5 Sunburst',
    modality: 'image',
    selectable: true,
  },
  {
    modelId: 'gpt-image-2.5-flare-c',
    name: 'OpenLux GPT Image 2.5 Flare C',
    modality: 'image',
    selectable: true,
  },
  {
    modelId: 'gpt-image-2.5-sunburst-c',
    name: 'OpenLux GPT Image 2.5 Sunburst C',
    modality: 'image',
    selectable: true,
  },
  {
    modelId: 'gpt-image-2.6-flare',
    name: 'OpenLux GPT Image 2.6 Flare',
    modality: 'image',
    // Ratio-priced upstream; no verified flat image price yet.
    selectable: false,
  },
  {
    modelId: 'gpt-image-2.6-sunburst',
    name: 'OpenLux GPT Image 2.6 Sunburst',
    modality: 'image',
    // Ratio-priced upstream; no verified flat image price yet.
    selectable: false,
  },
  {
    modelId: 'gpt-image-2.6-flare-c',
    name: 'OpenLux GPT Image 2.6 Flare C',
    modality: 'image',
    selectable: true,
  },
  {
    modelId: 'gpt-image-2.6-sunburst-c',
    name: 'OpenLux GPT Image 2.6 Sunburst C',
    modality: 'image',
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
