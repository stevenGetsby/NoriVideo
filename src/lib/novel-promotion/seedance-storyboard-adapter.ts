import type { EpisodeStoryboardWorkflowSegment } from '@/lib/novel-promotion/episode-storyboard-workflow'
import {
  buildSeedanceReferenceImageContentItems,
  type PanelSeedanceReferenceAsset,
} from '@/lib/novel-promotion/seedance-reference-assets'

export const DEFAULT_SEEDANCE_2_MODEL = 'doubao-seedance-2-0-260128'
export const DEFAULT_SEEDANCE_STORYBOARD_RATIO = '9:16'
export const DEFAULT_SEEDANCE_STORYBOARD_RESOLUTION = '720p'

export type SeedanceStoryboardRatio =
  | '16:9'
  | '4:3'
  | '1:1'
  | '3:4'
  | '9:16'
  | '21:9'
  | 'adaptive'

export type SeedanceStoryboardResolution = '480p' | '720p' | '1080p'

export type SeedanceStoryboardContentItem =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string }; role: 'reference_image' }

export interface SeedanceStoryboardTaskRequest {
  model: string
  content: SeedanceStoryboardContentItem[]
  resolution?: SeedanceStoryboardResolution
  ratio?: SeedanceStoryboardRatio
  duration?: number
  generate_audio?: boolean
  watermark?: boolean
  seed?: number
  camera_fixed?: boolean
}

export interface SeedanceStoryboardGenerationInput {
  prompt: string
  imageUrl: ''
  options: {
    modelId: string
    referenceImages: string[]
    resolution: SeedanceStoryboardResolution
    duration: number
    aspectRatio: SeedanceStoryboardRatio
    generateAudio: boolean
    watermark?: boolean
    seed?: number
    cameraFixed?: boolean
  }
}

export interface SeedanceStoryboardAdapterOptions {
  model?: string
  resolution?: SeedanceStoryboardResolution
  ratio?: SeedanceStoryboardRatio
  durationSeconds?: number
  generateAudio?: boolean
  watermark?: boolean
  seed?: number
  cameraFixed?: boolean
  maxReferenceImages?: number
}

function compact(value: string | null | undefined): string {
  return (value || '').replace(/\s+/g, ' ').trim()
}

function normalizeSeedance2Duration(value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error('SEEDANCE_STORYBOARD_DURATION_INVALID')
  }
  return Math.max(4, Math.min(15, Math.round(value)))
}

function normalizeModel(model: string | undefined): string {
  const value = compact(model)
  return value.startsWith('ark::') ? value.slice('ark::'.length) : value || DEFAULT_SEEDANCE_2_MODEL
}

function uniqueReferenceAssets(
  assets: PanelSeedanceReferenceAsset[],
  maxReferenceImages: number,
): PanelSeedanceReferenceAsset[] {
  const seen = new Set<string>()
  const result: PanelSeedanceReferenceAsset[] = []
  for (const asset of assets) {
    const imageUrl = compact(asset.imageUrl)
    if (!imageUrl || seen.has(imageUrl)) continue
    seen.add(imageUrl)
    result.push({ ...asset, imageUrl })
    if (result.length >= maxReferenceImages) break
  }
  return result
}

export function buildSeedanceStoryboardVideoTaskRequest(input: {
  segment: Pick<EpisodeStoryboardWorkflowSegment, 'videoPrompt' | 'durationSeconds'>
  referenceAssets?: PanelSeedanceReferenceAsset[]
  options?: SeedanceStoryboardAdapterOptions
}): SeedanceStoryboardTaskRequest {
  const prompt = input.segment.videoPrompt.trim()
  if (!prompt) {
    throw new Error('SEEDANCE_STORYBOARD_PROMPT_REQUIRED')
  }

  const options = input.options || {}
  const referenceAssets = uniqueReferenceAssets(
    input.referenceAssets || [],
    Math.max(0, Math.min(options.maxReferenceImages ?? 9, 9)),
  )
  const duration = normalizeSeedance2Duration(options.durationSeconds ?? input.segment.durationSeconds)

  return {
    model: normalizeModel(options.model),
    content: [
      { type: 'text', text: prompt },
      ...buildSeedanceReferenceImageContentItems(referenceAssets),
    ],
    resolution: options.resolution || DEFAULT_SEEDANCE_STORYBOARD_RESOLUTION,
    ratio: options.ratio || DEFAULT_SEEDANCE_STORYBOARD_RATIO,
    duration,
    generate_audio: options.generateAudio ?? true,
    ...(typeof options.watermark === 'boolean' ? { watermark: options.watermark } : {}),
    ...(typeof options.seed === 'number' ? { seed: options.seed } : {}),
    ...(typeof options.cameraFixed === 'boolean' ? { camera_fixed: options.cameraFixed } : {}),
  }
}

export function buildSeedanceStoryboardGenerationInput(input: {
  segment: Pick<EpisodeStoryboardWorkflowSegment, 'videoPrompt' | 'durationSeconds'>
  referenceAssets?: PanelSeedanceReferenceAsset[]
  options?: SeedanceStoryboardAdapterOptions
}): SeedanceStoryboardGenerationInput {
  const request = buildSeedanceStoryboardVideoTaskRequest(input)
  const promptItem = request.content[0]
  if (promptItem.type !== 'text') {
    throw new Error('SEEDANCE_STORYBOARD_PROMPT_REQUIRED')
  }
  return {
    prompt: promptItem.text,
    imageUrl: '',
    options: {
      modelId: request.model,
      referenceImages: request.content
        .flatMap((item) => item.type === 'image_url' ? [item.image_url.url] : []),
      resolution: request.resolution || DEFAULT_SEEDANCE_STORYBOARD_RESOLUTION,
      duration: request.duration || normalizeSeedance2Duration(input.segment.durationSeconds),
      aspectRatio: request.ratio || DEFAULT_SEEDANCE_STORYBOARD_RATIO,
      generateAudio: request.generate_audio ?? true,
      ...(typeof request.watermark === 'boolean' ? { watermark: request.watermark } : {}),
      ...(typeof request.seed === 'number' ? { seed: request.seed } : {}),
      ...(typeof request.camera_fixed === 'boolean' ? { cameraFixed: request.camera_fixed } : {}),
    },
  }
}
