import {
  findBuiltinCapabilityCatalogEntry,
  listBuiltinCapabilityCatalog,
  type BuiltinCapabilityCatalogEntry,
} from '@/lib/model-capabilities/catalog'
import { findBuiltinPricingCatalogEntry } from '@/lib/model-pricing/catalog'
import { registerOfficialModel } from '@/lib/providers/official/model-registry'
import profiles from './model-profiles.json'
import type { TggModelDefinition, TggReferenceFormat } from './types'

const REFERENCE_FORMATS: readonly TggReferenceFormat[] = ['categorized', 'files', 'files-named']

interface TggModelProfile {
  referenceFormat: TggReferenceFormat
  ratios: string[]
  aspectRatioField?: boolean
}

function providerKeyOf(providerId: string): string {
  const marker = providerId.indexOf(':')
  return marker === -1 ? providerId : providerId.slice(0, marker)
}

function readProfile(modelId: string): TggModelProfile | null {
  const raw = (profiles as Record<string, unknown>)[modelId]
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  const referenceFormat = record.referenceFormat
  if (typeof referenceFormat !== 'string' || !REFERENCE_FORMATS.includes(referenceFormat as TggReferenceFormat)) return null
  if (!Array.isArray(record.ratios)) return null
  const ratios = record.ratios
    .filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
    .map((item) => item.trim())
  return {
    referenceFormat: referenceFormat as TggReferenceFormat,
    ratios,
    ...(record.aspectRatioField === true ? { aspectRatioField: true } : {}),
  }
}

function composeDefinition(entry: BuiltinCapabilityCatalogEntry): TggModelDefinition {
  const video = entry.capabilities?.video
  const inputSchema = video?.inputSchema
  const maxImages = inputSchema?.image?.max ?? 0
  const maxVideos = inputSchema?.video?.max ?? 0
  const maxAudios = inputSchema?.audio?.max ?? 0
  const profile = readProfile(entry.modelId)
  const resolutions = [...(video?.resolutionOptions ?? [])]
  const definition: TggModelDefinition = {
    modelId: entry.modelId,
    name: entry.modelId,
    modality: 'video',
    // Unprofiled models are never selectable; the documented generic format
    // only serves the discovery catalog until a profile is verified.
    referenceFormat: profile?.referenceFormat ?? 'categorized',
    supportsImages: maxImages > 0,
    supportsVideos: maxVideos > 0,
    supportsAudios: maxAudios > 0,
    maxImages,
    maxVideos,
    maxAudios,
    supportsResolution: resolutions.length > 0,
    supportsGenerateAudio: video?.supportGenerateAudio === true,
    supportsAspectRatioField: profile?.aspectRatioField === true,
    supportsFirstLastFrame: video?.firstlastframe === true,
    durationOptions: [...(video?.durationOptions ?? [])],
    ratios: profile?.ratios ?? [],
    resolutions,
  }
  registerOfficialModel({ provider: 'tgg', modality: 'video', modelId: definition.modelId })
  return definition
}

export function listTggCatalogModels(): TggModelDefinition[] {
  return listBuiltinCapabilityCatalog()
    .filter((entry) => entry.modelType === 'video' && providerKeyOf(entry.provider) === 'tgg')
    .map(composeDefinition)
}

function hasVerifiedPricing(model: TggModelDefinition): boolean {
  const tiers = findBuiltinPricingCatalogEntry('video', 'tgg', model.modelId)?.pricing.tiers
  if (!tiers?.length) return false
  // Every selectable duration needs an explicit amount > 0 tier; duration
  // scaling from a 5s base would misprice non-linear upstream price sheets.
  return model.durationOptions.every((seconds) => (
    tiers.some((tier) => tier.when.duration === seconds && tier.amount > 0)
  ))
}

export function listTggSelectableModels(): TggModelDefinition[] {
  return listTggCatalogModels().filter((model) => (
    Boolean(readProfile(model.modelId))
    && model.durationOptions.length > 0
    && hasVerifiedPricing(model)
  ))
}

export function getTggModelDefinition(modelId: string): TggModelDefinition {
  const normalizedModelId = modelId.trim()
  const entry = findBuiltinCapabilityCatalogEntry('video', 'tgg', normalizedModelId)
  if (!entry) throw new Error(`MODEL_NOT_REGISTERED: tgg/video/${normalizedModelId}`)
  return composeDefinition(entry)
}
