import { getProviderConfig } from '@/lib/api-config'
import type { GenerateResult } from '@/lib/generators/base'
import {
  normalizeReferenceImagesForGeneration,
  normalizeToOriginalMediaUrl,
  normalizeToPublicImageUrlForGeneration,
} from '@/lib/media/outbound-image'
import { getTopenrouterModelDefinition } from './catalog'
import { asRecord, readFiniteNumber, readString, requestTopenrouter } from './client'
import { formatTopenrouterExternalId } from './external-id'
import type { TopenrouterGenerateRequestOptions } from './types'

export interface TopenrouterVideoGenerateParams {
  userId: string
  imageUrl: string
  prompt?: string
  options: TopenrouterGenerateRequestOptions
}

type ContentItem =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string }; role: 'first_frame' | 'last_frame' | 'reference_image' }
  | { type: 'video_url'; video_url: { url: string }; role: 'reference_video' }
  | { type: 'audio_url'; audio_url: { url: string }; role: 'reference_audio' }

type SeedanceOmniReferenceTaskType = 'auto' | 'reference' | 'edit' | 'extend'

const SEEDANCE_25_TASK_TYPES = new Set<SeedanceOmniReferenceTaskType>(['auto', 'reference', 'edit', 'extend'])

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(readString).filter(Boolean) : []
}

async function normalizePublicUrl(value: string, kind: 'VIDEO' | 'AUDIO'): Promise<string> {
  const normalized = await normalizeToOriginalMediaUrl(value)
  if (!/^https?:\/\//i.test(normalized)) {
    throw new Error(`TOPENROUTER_${kind}_URL_PUBLIC_REQUIRED`)
  }
  return normalized
}

function pickAllowed(value: string, allowed: readonly string[], code: string): string | undefined {
  const normalized = value.trim()
  if (!normalized) return undefined
  const candidate = normalized.toLowerCase() === 'auto' ? 'adaptive' : normalized
  if (!allowed.includes(candidate)) throw new Error(`${code}: ${normalized}`)
  return candidate
}

function normalizeDuration(
  value: unknown,
  range: readonly [number, number],
  allowAdaptiveDuration = false,
): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const parsed = readFiniteNumber(value)
  if (parsed === undefined || !Number.isInteger(parsed)) {
    throw new Error(`TOPENROUTER_VIDEO_DURATION_UNSUPPORTED: ${String(value)}`)
  }
  if (allowAdaptiveDuration && parsed === -1) return -1
  if (parsed < range[0] || parsed > range[1]) {
    throw new Error(`TOPENROUTER_VIDEO_DURATION_UNSUPPORTED: ${String(value)}`)
  }
  return parsed
}

export async function buildTopenrouterVideoRequest(
  params: TopenrouterVideoGenerateParams,
): Promise<{ model: ReturnType<typeof getTopenrouterModelDefinition>; body: Record<string, unknown> }> {
  const model = getTopenrouterModelDefinition(params.options.modelId)

  const prompt = readString(params.prompt) || readString(params.options.prompt)
  const firstFrame = readString(params.imageUrl)
  const lastFrame = readString(params.options.lastFrameImageUrl)
  if (lastFrame && !model.supportsFirstLastFrame) {
    throw new Error(`TOPENROUTER_VIDEO_LAST_FRAME_UNSUPPORTED: ${model.modelId}`)
  }
  if (lastFrame && !firstFrame) throw new Error('TOPENROUTER_VIDEO_FIRST_FRAME_REQUIRED')

  const referenceImageUrls = stringArray(params.options.referenceImages)
  if (referenceImageUrls.length > model.maxReferenceImages) {
    throw new Error(`TOPENROUTER_VIDEO_REFERENCE_IMAGES_LIMIT: ${referenceImageUrls.length}`)
  }
  const referenceVideoUrls = stringArray(params.options.videos)
  if (referenceVideoUrls.length > model.maxReferenceVideos) {
    throw new Error(`TOPENROUTER_VIDEO_REFERENCE_VIDEOS_LIMIT: ${referenceVideoUrls.length}`)
  }
  const referenceAudioUrls = stringArray(params.options.audios)
  if (referenceAudioUrls.length > model.maxReferenceAudios) {
    throw new Error(`TOPENROUTER_VIDEO_REFERENCE_AUDIOS_LIMIT: ${referenceAudioUrls.length}`)
  }
  if (!prompt && !firstFrame && !referenceImageUrls.length && !referenceVideoUrls.length && !referenceAudioUrls.length) {
    throw new Error('TOPENROUTER_VIDEO_CONTENT_REQUIRED')
  }

  const hasFirstLastFrame = Boolean(firstFrame || lastFrame)
  const hasReferenceVideo = referenceVideoUrls.length > 0
  const rawRequestedTaskType = readString(
    params.options.omniReferenceTaskType ?? params.options.omni_reference_task_type,
  ).toLowerCase()
  if (rawRequestedTaskType && !SEEDANCE_25_TASK_TYPES.has(rawRequestedTaskType as SeedanceOmniReferenceTaskType)) {
    throw new Error(`TOPENROUTER_SEEDANCE_OMNI_REFERENCE_TASK_TYPE_UNSUPPORTED: ${rawRequestedTaskType}`)
  }
  const omniReferenceTaskType: Exclude<SeedanceOmniReferenceTaskType, 'auto'> | '' =
    rawRequestedTaskType && rawRequestedTaskType !== 'auto'
      ? rawRequestedTaskType as Exclude<SeedanceOmniReferenceTaskType, 'auto'>
      : ''
  if ((omniReferenceTaskType === 'edit' || omniReferenceTaskType === 'extend') && !hasReferenceVideo) {
    throw new Error(`TOPENROUTER_SEEDANCE_${omniReferenceTaskType.toUpperCase()}_VIDEO_REQUIRED`)
  }

  const generateAudio = typeof params.options.generateAudio === 'boolean'
    ? params.options.generateAudio
    : model.supportsGenerateAudio ? true : undefined
  if (generateAudio === true && !model.supportsGenerateAudio) {
    throw new Error(`TOPENROUTER_VIDEO_GENERATE_AUDIO_UNSUPPORTED: ${model.modelId}`)
  }

  const resolution = readString(params.options.resolution)
  const resolvedResolution = resolution
    ? pickAllowed(resolution.toLowerCase(), model.resolutions, 'TOPENROUTER_VIDEO_RESOLUTION_UNSUPPORTED')
    : '720p'
  const requestedRatio = pickAllowed(
    readString(params.options.aspectRatio) || readString(params.options.ratio),
    model.ratios,
    'TOPENROUTER_VIDEO_RATIO_UNSUPPORTED',
  )
  const allowAdaptiveDuration = omniReferenceTaskType === 'edit'
    || (hasReferenceVideo && omniReferenceTaskType === '')
  const duration = normalizeDuration(params.options.duration, model.durationRange, allowAdaptiveDuration)
  const forcedAdaptive = hasFirstLastFrame || omniReferenceTaskType === 'edit' || omniReferenceTaskType === 'extend'
  const effectiveRatio = forcedAdaptive ? 'adaptive' : requestedRatio
  const effectiveDuration = omniReferenceTaskType === 'edit' ? -1 : duration

  const content: ContentItem[] = []
  if (prompt) content.push({ type: 'text', text: prompt })
  if (firstFrame) {
    content.push({
      type: 'image_url',
      image_url: { url: await normalizeToPublicImageUrlForGeneration(firstFrame) },
      role: 'first_frame',
    })
  }
  if (lastFrame) {
    content.push({
      type: 'image_url',
      image_url: { url: await normalizeToPublicImageUrlForGeneration(lastFrame) },
      role: 'last_frame',
    })
  }
  const referenceImages = await normalizeReferenceImagesForGeneration(
    referenceImageUrls,
    { context: { provider: params.options.provider, modelId: model.modelId } },
  )
  for (const url of referenceImages) {
    content.push({ type: 'image_url', image_url: { url }, role: 'reference_image' })
  }
  for (const url of referenceVideoUrls) {
    content.push({
      type: 'video_url',
      video_url: { url: await normalizePublicUrl(url, 'VIDEO') },
      role: 'reference_video',
    })
  }
  for (const url of referenceAudioUrls) {
    content.push({
      type: 'audio_url',
      audio_url: { url: await normalizePublicUrl(url, 'AUDIO') },
      role: 'reference_audio',
    })
  }

  return {
    model,
    body: {
      model: model.modelId,
      content,
      ...(resolvedResolution ? { resolution: resolvedResolution } : {}),
      ...(effectiveRatio ? { ratio: effectiveRatio } : {}),
      ...(typeof effectiveDuration === 'number' ? { duration: effectiveDuration } : {}),
      ...(typeof generateAudio === 'boolean' && model.supportsGenerateAudio ? { generate_audio: generateAudio } : {}),
      ...(typeof params.options.watermark === 'boolean' ? { watermark: params.options.watermark } : {}),
      ...(omniReferenceTaskType ? { omni_reference_task_type: omniReferenceTaskType } : {}),
    },
  }
}

export async function generateTopenrouterVideo(params: TopenrouterVideoGenerateParams): Promise<GenerateResult> {
  const { model, body } = await buildTopenrouterVideoRequest(params)
  const config = await getProviderConfig(params.userId, params.options.provider)
  const payload = await requestTopenrouter({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    path: '/api/v3/contents/generations/tasks',
    method: 'POST',
    body,
  })
  const taskId = readString(asRecord(payload)?.id)
  if (!taskId) throw new Error('TOPENROUTER_VIDEO_TASK_ID_MISSING')

  return {
    success: true,
    async: true,
    requestId: taskId,
    externalId: formatTopenrouterExternalId({
      providerId: params.options.provider,
      modelId: model.modelId,
      taskId,
    }),
  }
}
