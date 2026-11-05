import {
  assertOfficialModelRegistered,
  registerOfficialModel,
} from '@/lib/providers/official/model-registry'

export type OpenLuxModelModality = 'image'

export interface OpenLuxModelDefinition {
  modelId: string
  name: string
  modality: OpenLuxModelModality
}

const OPENLUX_CATALOG: readonly OpenLuxModelDefinition[] = [
  { modelId: 'gpt-image-2.5-flare', name: 'OpenLux GPT Image 2.5 Flare', modality: 'image' },
  { modelId: 'gpt-image-2.5-sunburst', name: 'OpenLux GPT Image 2.5 Sunburst', modality: 'image' },
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

export function listOpenLuxCatalogModels(modality?: OpenLuxModelModality): OpenLuxModelDefinition[] {
  ensureOpenLuxCatalogRegistered()
  return OPENLUX_CATALOG
    .filter((model) => !modality || model.modality === modality)
    .map((model) => ({ ...model }))
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
