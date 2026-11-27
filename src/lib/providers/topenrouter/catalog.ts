import { findBuiltinPricingCatalogEntry } from '@/lib/model-pricing/catalog'
import {
  assertOfficialModelRegistered,
  registerOfficialModel,
} from '@/lib/providers/official/model-registry'
import type { TopenrouterVideoModelId } from './types'

export interface TopenrouterModelDefinition {
  modelId: TopenrouterVideoModelId
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

const TOPENROUTER_CATALOG: readonly TopenrouterModelDefinition[] = [
  {
    modelId: 'doubao-seedance-2-5-260628',
    name: 'Seedance 2.5（TopenRouter）',
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
    modelId: 'doubao-seedance-2-5-260628-exp',
    name: 'Seedance 2.5 Exp（TopenRouter）',
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
]

export function listTopenrouterCatalogModels(): TopenrouterModelDefinition[] {
  for (const model of TOPENROUTER_CATALOG) {
    registerOfficialModel({ provider: 'topenrouter', modality: 'video', modelId: model.modelId })
  }
  return [...TOPENROUTER_CATALOG]
}

export function listTopenrouterSelectableModels(): TopenrouterModelDefinition[] {
  return listTopenrouterCatalogModels().filter((model) => (
    Boolean(findBuiltinPricingCatalogEntry('video', 'topenrouter', model.modelId))
  ))
}

export function getTopenrouterModelDefinition(modelId: string): TopenrouterModelDefinition {
  const normalized = modelId.trim()
  const model = TOPENROUTER_CATALOG.find((item) => item.modelId === normalized)
  if (!model) throw new Error(`TOPENROUTER_MODEL_UNSUPPORTED: ${normalized}`)
  assertOfficialModelRegistered({ provider: 'topenrouter', modality: 'video', modelId: model.modelId })
  return model
}
