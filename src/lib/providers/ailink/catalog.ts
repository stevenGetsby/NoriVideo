import { findBuiltinPricingCatalogEntry } from '@/lib/model-pricing/catalog'
import {
  assertOfficialModelRegistered,
  registerOfficialModel,
} from '@/lib/providers/official/model-registry'
import type { AilinkVideoModelId } from './types'

export interface AilinkModelDefinition {
  modelId: AilinkVideoModelId
  name: string
  modality: 'video'
  maxReferenceImages: number
  maxReferenceVideos: number
  maxReferenceAudios: number
  supportsFirstLastFrame: boolean
  supportsGenerateAudio: boolean
  durationRange: readonly [number, number]
  resolutions: readonly string[]
  ratios: readonly string[]
}

const RATIOS = ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9', 'adaptive'] as const

const AILINK_CATALOG: readonly AilinkModelDefinition[] = [
  {
    modelId: 'doubao-seedance-2-5',
    name: 'Seedance 2.5（AILink）',
    modality: 'video',
    maxReferenceImages: 30,
    maxReferenceVideos: 10,
    maxReferenceAudios: 10,
    supportsFirstLastFrame: true,
    supportsGenerateAudio: true,
    durationRange: [4, 30],
    resolutions: ['480p', '720p', '1080p'],
    ratios: RATIOS,
  },
  {
    modelId: 'doubao-seedance-2-5-flash',
    name: 'Seedance 2.5 Flash（AILink）',
    modality: 'video',
    maxReferenceImages: 30,
    maxReferenceVideos: 10,
    maxReferenceAudios: 10,
    supportsFirstLastFrame: true,
    supportsGenerateAudio: true,
    durationRange: [4, 30],
    resolutions: ['480p', '720p'],
    ratios: RATIOS,
  },
]

export function listAilinkCatalogModels(): AilinkModelDefinition[] {
  for (const model of AILINK_CATALOG) {
    registerOfficialModel({ provider: 'ailink', modality: 'video', modelId: model.modelId })
  }
  return [...AILINK_CATALOG]
}

export function listAilinkSelectableModels(): AilinkModelDefinition[] {
  return listAilinkCatalogModels().filter((model) => (
    Boolean(findBuiltinPricingCatalogEntry('video', 'ailink', model.modelId))
  ))
}

export function getAilinkModelDefinition(modelId: string): AilinkModelDefinition {
  const normalized = modelId.trim()
  const model = AILINK_CATALOG.find((item) => item.modelId === normalized)
  if (!model) throw new Error(`AILINK_MODEL_UNSUPPORTED: ${normalized}`)
  assertOfficialModelRegistered({ provider: 'ailink', modality: 'video', modelId: model.modelId })
  return model
}
