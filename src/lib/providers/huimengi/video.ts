import { getProviderConfig } from '@/lib/api-config'
import type { GenerateResult } from '@/lib/generators/base'
import {
  normalizeReferenceImagesForGeneration,
  normalizeToOriginalMediaUrl,
  normalizeToPublicImageUrlForGeneration,
} from '@/lib/media/outbound-image'
import { getHuimengiModelDefinition } from './catalog'
import { asRecord, readFiniteNumber, readString, requestHuimengi } from './client'
import { formatHuimengiExternalId } from './external-id'
import type { HuimengiGenerateRequestOptions } from './types'

export interface HuimengiVideoGenerateParams {
  userId: string
  imageUrl: string
  prompt?: string
  options: HuimengiGenerateRequestOptions
}

interface VideoConstraints {
  ratios: readonly string[]
  resolutions: readonly string[]
  duration: readonly [number, number]
}

const VIDEO_CONSTRAINTS: Readonly<Record<string, VideoConstraints>> = {
  'wan3.0-video': {
    ratios: ['16:9', '4:3', '1:1', '3:4', '9:16', 'adaptive'],
    resolutions: ['480P', '720P', '1080P'],
    duration: [2, 30],
  },
  'wan3.0-video-value': {
    ratios: ['16:9', '4:3', '1:1', '3:4', '9:16', 'adaptive'],
    resolutions: ['720p', '1080p', '2k', '4k'],
    duration: [2, 30],
  },
  'seedance-1.5-pro': {
    ratios: ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9', 'adaptive'],
    resolutions: ['480p', '720p', '1080p'],
    duration: [4, 12],
  },
  'seedance-1.0-pro': {
    ratios: ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9', 'adaptive'],
    resolutions: ['480p', '720p', '1080p'],
    duration: [2, 12],
  },
  'minimax-h3': {
    ratios: ['adaptive', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16'],
    resolutions: ['2K', '768P'],
    duration: [4, 15],
  },
  'happyhorse-1.1': {
    ratios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', '9:21', '5:4', '4:5'],
    resolutions: ['1080P', '720P'],
    duration: [3, 15],
  },
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(readString).filter(Boolean)
    : []
}

async function normalizeMediaUrl(value: string, kind: 'video' | 'audio'): Promise<string> {
  const normalized = await normalizeToOriginalMediaUrl(value)
  if (!/^https?:\/\//i.test(normalized)) {
    throw new Error(`HUIMENGI_${kind.toUpperCase()}_URL_PUBLIC_REQUIRED`)
  }
  return normalized
}

function normalizeResolution(
  value: string,
  resolutionCase: 'lower' | 'upper',
  allowed: readonly string[],
): string | undefined {
  const normalized = value.trim()
  if (!normalized) return undefined
  const candidate = resolutionCase === 'upper' ? normalized.toUpperCase() : normalized.toLowerCase()
  if (!allowed.includes(candidate)) {
    throw new Error(`HUIMENGI_VIDEO_RESOLUTION_UNSUPPORTED: ${normalized}`)
  }
  return candidate
}

function normalizeRatio(value: string, allowed: readonly string[]): string | undefined {
  const normalized = value.trim()
  if (!normalized) return undefined
  const candidate = normalized.toLowerCase() === 'auto' ? 'adaptive' : normalized
  if (!allowed.includes(candidate)) {
    throw new Error(`HUIMENGI_VIDEO_RATIO_UNSUPPORTED: ${normalized}`)
  }
  return candidate
}

function normalizeDuration(value: unknown, range: readonly [number, number]): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const parsed = readFiniteNumber(value)
  if (parsed === undefined || !Number.isInteger(parsed) || parsed < range[0] || parsed > range[1]) {
    throw new Error(`HUIMENGI_VIDEO_DURATION_UNSUPPORTED: ${String(value)}`)
  }
  return parsed
}

export async function generateHuimengiVideo(params: HuimengiVideoGenerateParams): Promise<GenerateResult> {
  const model = getHuimengiModelDefinition(params.options.modelId, 'video')
  const constraints = VIDEO_CONSTRAINTS[model.modelId]
  if (!constraints) throw new Error(`HUIMENGI_VIDEO_MODEL_UNSUPPORTED: ${model.modelId}`)

  const prompt = readString(params.prompt) || readString(params.options.prompt)
  const firstFrame = readString(params.imageUrl)
  const lastFrame = readString(params.options.lastFrameImageUrl)
  if (lastFrame && !model.supportsFirstLastFrame) {
    throw new Error(`HUIMENGI_VIDEO_LAST_FRAME_UNSUPPORTED: ${model.modelId}`)
  }
  if (lastFrame && !firstFrame) throw new Error('HUIMENGI_VIDEO_FIRST_FRAME_REQUIRED')

  const referenceImages = await normalizeReferenceImagesForGeneration(
    stringArray(params.options.referenceImages),
    { context: { provider: params.options.provider, modelId: model.modelId } },
  )
  if (referenceImages.length > model.maxReferenceImages) {
    throw new Error(`HUIMENGI_VIDEO_REFERENCE_IMAGES_LIMIT: ${referenceImages.length}`)
  }
  const referenceVideos = stringArray(params.options.videos)
  if (referenceVideos.length && !model.supportsReferenceVideos) {
    throw new Error(`HUIMENGI_VIDEO_REFERENCE_VIDEOS_UNSUPPORTED: ${model.modelId}`)
  }
  const referenceAudios = stringArray(params.options.audios)
  if (referenceAudios.length && !model.supportsReferenceAudios) {
    throw new Error(`HUIMENGI_VIDEO_REFERENCE_AUDIOS_UNSUPPORTED: ${model.modelId}`)
  }
  if (!prompt && !firstFrame && !referenceImages.length && !referenceVideos.length && !referenceAudios.length) {
    throw new Error('HUIMENGI_VIDEO_CONTENT_REQUIRED')
  }

  const generateAudio = params.options.generateAudio
  if (generateAudio === true && (!model.supportsGenerateAudio || !model.audioParam)) {
    throw new Error(`HUIMENGI_VIDEO_GENERATE_AUDIO_UNSUPPORTED: ${model.modelId}`)
  }

  const ratioInput = readString(params.options.aspectRatio) || readString(params.options.ratio)
  const ratio = model.modelId === 'minimax-h3' && firstFrame
    ? 'adaptive'
    : normalizeRatio(ratioInput, constraints.ratios)
  const resolution = normalizeResolution(
    readString(params.options.resolution),
    model.resolutionCase,
    constraints.resolutions,
  )
  const duration = normalizeDuration(params.options.duration, constraints.duration)
  const seed = readFiniteNumber(params.options.seed)
  const resolvedFirstFrame = firstFrame ? await normalizeToPublicImageUrlForGeneration(firstFrame) : ''
  const resolvedLastFrame = lastFrame ? await normalizeToPublicImageUrlForGeneration(lastFrame) : ''
  const resolvedReferenceVideos = await Promise.all(referenceVideos.map((url) => normalizeMediaUrl(url, 'video')))
  const resolvedReferenceAudios = await Promise.all(referenceAudios.map((url) => normalizeMediaUrl(url, 'audio')))

  const requestParams: Record<string, unknown> = {
    ...(prompt ? { prompt } : {}),
    ...(resolvedLastFrame
      ? { first_frame_image: resolvedFirstFrame, last_frame_image: resolvedLastFrame }
      : resolvedFirstFrame ? { image_url: resolvedFirstFrame } : {}),
    ...(referenceImages.length ? { reference_images: referenceImages } : {}),
    ...(resolvedReferenceVideos.length ? { reference_videos: resolvedReferenceVideos } : {}),
    ...(resolvedReferenceAudios.length ? { reference_audios: resolvedReferenceAudios } : {}),
    ...(ratio ? { ratio } : {}),
    ...(resolution ? { resolution } : {}),
    ...(typeof duration === 'number' ? { duration } : {}),
    ...(typeof seed === 'number' && Number.isInteger(seed) ? { seed } : {}),
    ...(typeof generateAudio === 'boolean' && model.audioParam ? { [model.audioParam]: generateAudio } : {}),
    ...(model.supportsWatermark && typeof params.options.watermark === 'boolean'
      ? { watermark: params.options.watermark }
      : {}),
    ...(model.supportsPromptExtend && typeof params.options.promptExtend === 'boolean'
      ? { prompt_extend: params.options.promptExtend }
      : {}),
    ...(model.supportsCameraFixed && typeof params.options.cameraFixed === 'boolean'
      ? { camera_fixed: params.options.cameraFixed }
      : {}),
    ...(model.supportsReturnLastFrame && typeof params.options.returnLastFrame === 'boolean'
      ? { return_last_frame: params.options.returnLastFrame }
      : {}),
  }

  const config = await getProviderConfig(params.userId, params.options.provider)
  const payload = await requestHuimengi({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    path: '/api/v1/tasks',
    method: 'POST',
    body: { model: model.modelId, params: requestParams },
  })
  const record = asRecord(payload)
  const taskId = readString(record?.task_id) || readString(record?.id)
  if (!taskId) throw new Error('HUIMENGI_VIDEO_TASK_ID_MISSING')

  return {
    success: true,
    async: true,
    requestId: taskId,
    externalId: formatHuimengiExternalId({
      type: 'VIDEO',
      providerId: params.options.provider,
      modelId: model.modelId,
      taskId,
    }),
  }
}
