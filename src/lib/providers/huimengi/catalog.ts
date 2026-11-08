import {
  assertOfficialModelRegistered,
  registerOfficialModel,
} from '@/lib/providers/official/model-registry'
import type { HuimengiModelDefinition, HuimengiModelModality } from './types'

/**
 * Only models that the platform can drive with its existing image/video
 * contract are published here. Seedance 2.x is token-metered; its ids are
 * listed in SEEDANCE_2_TOKEN_PRICED_MODEL_IDS so billing settles the actual
 * completion tokens reported by the task result.
 */
const HUIMENGI_CATALOG: readonly HuimengiModelDefinition[] = [
  {
    modelId: 'seedream-5.0-pro',
    name: 'Seedream 5.0 Pro（绘梦）',
    modality: 'image',
    resolutionCase: 'upper',
    maxReferenceImages: 10,
    supportsFirstLastFrame: false,
    supportsGenerateAudio: false,
    supportsOutputFormat: true,
  },
  {
    modelId: 'seedream-5.0-lite',
    name: 'Seedream 5.0 Lite（绘梦）',
    modality: 'image',
    resolutionCase: 'upper',
    maxReferenceImages: 14,
    supportsFirstLastFrame: false,
    supportsGenerateAudio: false,
    supportsOutputFormat: true,
  },
  {
    modelId: 'qwen-image-3.0-pro',
    name: 'Qwen Image 3.0 Pro（绘梦）',
    modality: 'image',
    resolutionCase: 'lower',
    maxReferenceImages: 3,
    supportsFirstLastFrame: false,
    supportsGenerateAudio: false,
  },
  {
    modelId: 'qwen-image-3.0',
    name: 'Qwen Image 3.0（绘梦）',
    modality: 'image',
    resolutionCase: 'lower',
    maxReferenceImages: 3,
    supportsFirstLastFrame: false,
    supportsGenerateAudio: false,
  },
  {
    modelId: 'nb-2.1',
    name: 'NB 2.1（绘梦）',
    modality: 'image',
    resolutionCase: 'upper',
    maxReferenceImages: 14,
    supportsFirstLastFrame: false,
    supportsGenerateAudio: false,
  },
  {
    modelId: 'wan3.0-video',
    name: 'Wan 3.0 Video（绘梦）',
    modality: 'video',
    resolutionCase: 'upper',
    maxReferenceImages: 10,
    supportsFirstLastFrame: true,
    supportsGenerateAudio: true,
    audioParam: 'audio',
    supportsReferenceVideos: true,
    supportsReferenceAudios: true,
    supportsWatermark: true,
    supportsPromptExtend: true,
  },
  {
    modelId: 'wan3.0-video-value',
    name: 'Wan 3.0 Video Value（绘梦）',
    modality: 'video',
    resolutionCase: 'lower',
    maxReferenceImages: 10,
    supportsFirstLastFrame: true,
    supportsGenerateAudio: true,
    audioParam: 'audio',
    supportsReferenceVideos: true,
    supportsReferenceAudios: true,
    supportsWatermark: true,
    supportsPromptExtend: true,
  },
  {
    modelId: 'seedance-2.0-mini',
    name: 'Seedance 2.0 Mini（绘梦）',
    modality: 'video',
    resolutionCase: 'lower',
    maxReferenceImages: 9,
    supportsFirstLastFrame: false,
    firstFrameParam: 'first_frame_image',
    supportsGenerateAudio: true,
    audioParam: 'generate_audio',
    supportsReferenceVideos: true,
    supportsReferenceAudios: true,
    maxReferenceVideos: 3,
    maxReferenceAudios: 3,
    supportsReturnLastFrame: true,
  },
  {
    modelId: 'seedance-2.0-fast',
    name: 'Seedance 2.0 Fast（绘梦）',
    modality: 'video',
    resolutionCase: 'lower',
    maxReferenceImages: 9,
    supportsFirstLastFrame: false,
    firstFrameParam: 'first_frame_image',
    supportsGenerateAudio: true,
    audioParam: 'generate_audio',
    supportsReferenceVideos: true,
    supportsReferenceAudios: true,
    maxReferenceVideos: 3,
    maxReferenceAudios: 3,
    supportsReturnLastFrame: true,
  },
  {
    modelId: 'seedance-2.0',
    name: 'Seedance 2.0（绘梦）',
    modality: 'video',
    resolutionCase: 'lower',
    maxReferenceImages: 9,
    supportsFirstLastFrame: false,
    firstFrameParam: 'first_frame_image',
    supportsGenerateAudio: true,
    audioParam: 'generate_audio',
    supportsReferenceVideos: true,
    supportsReferenceAudios: true,
    maxReferenceVideos: 3,
    maxReferenceAudios: 3,
    supportsReturnLastFrame: true,
  },
  {
    modelId: 'seedance-2.5',
    name: 'Seedance 2.5（绘梦）',
    modality: 'video',
    resolutionCase: 'lower',
    maxReferenceImages: 30,
    supportsFirstLastFrame: false,
    firstFrameParam: 'first_frame_image',
    supportsGenerateAudio: true,
    audioParam: 'generate_audio',
    supportsReferenceVideos: true,
    supportsReferenceAudios: true,
    maxReferenceVideos: 10,
    maxReferenceAudios: 10,
    supportsReturnLastFrame: true,
  },
  {
    modelId: 'seedance-1.5-pro',
    name: 'Seedance 1.5 Pro（绘梦）',
    modality: 'video',
    resolutionCase: 'lower',
    maxReferenceImages: 0,
    supportsFirstLastFrame: true,
    supportsGenerateAudio: true,
    audioParam: 'generate_audio',
    supportsCameraFixed: true,
    supportsReturnLastFrame: true,
  },
  {
    modelId: 'seedance-1.0-pro',
    name: 'Seedance 1.0 Pro（绘梦）',
    modality: 'video',
    resolutionCase: 'lower',
    maxReferenceImages: 0,
    supportsFirstLastFrame: true,
    supportsGenerateAudio: false,
    supportsCameraFixed: true,
    supportsReturnLastFrame: true,
  },
  {
    modelId: 'minimax-h3',
    name: 'MiniMax H3（绘梦）',
    modality: 'video',
    resolutionCase: 'upper',
    maxReferenceImages: 9,
    supportsFirstLastFrame: true,
    supportsGenerateAudio: false,
    supportsReferenceVideos: true,
    supportsReferenceAudios: true,
  },
  {
    modelId: 'happyhorse-1.1',
    name: 'HappyHorse 1.1（绘梦）',
    modality: 'video',
    resolutionCase: 'upper',
    maxReferenceImages: 9,
    supportsFirstLastFrame: false,
    supportsGenerateAudio: false,
    supportsWatermark: true,
  },
]

let initialized = false

export function ensureHuimengiCatalogRegistered(): void {
  if (initialized) return
  initialized = true
  for (const model of HUIMENGI_CATALOG) {
    registerOfficialModel({
      provider: 'huimengi',
      modality: model.modality,
      modelId: model.modelId,
    })
  }
}

export function listHuimengiCatalogModels(modality?: HuimengiModelModality): HuimengiModelDefinition[] {
  ensureHuimengiCatalogRegistered()
  return HUIMENGI_CATALOG
    .filter((model) => !modality || model.modality === modality)
    .map((model) => ({ ...model }))
}

export function getHuimengiModelDefinition(
  modelId: string,
  expectedModality?: HuimengiModelModality,
): HuimengiModelDefinition {
  ensureHuimengiCatalogRegistered()
  const normalizedModelId = modelId.trim()
  const model = HUIMENGI_CATALOG.find((item) => item.modelId === normalizedModelId)
  if (!model || expectedModality && model.modality !== expectedModality) {
    throw new Error(`MODEL_NOT_REGISTERED: huimengi/${expectedModality || 'unknown'}/${normalizedModelId}`)
  }
  assertOfficialModelRegistered({
    provider: 'huimengi',
    modality: model.modality,
    modelId: model.modelId,
  })
  return { ...model }
}
