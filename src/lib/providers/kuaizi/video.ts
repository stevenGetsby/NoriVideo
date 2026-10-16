import { getProviderConfig } from '@/lib/api-config'
import type { GenerateResult } from '@/lib/generators/base'
import {
  normalizeReferenceImagesForGeneration,
  normalizeToOriginalMediaUrl,
  normalizeToPublicImageUrlForGeneration,
} from '@/lib/media/outbound-image'
import { getKuaiziModelDefinition } from './catalog'
import { asRecord, postKuaiziApiKey, readString, requestKuaiziBearer } from './client'
import { formatKuaiziExternalId } from './external-id'
import type { KuaiziGenerateRequestOptions } from './types'
import { normalizeSeedanceImageReference, normalizeSeedanceImageReferences, normalizeSeedanceMediaReference } from '@/lib/media/seedance-reference'
import { prepareKuaiziSeedanceImage } from '@/lib/media/kuaizi-seedance-image'

export interface KuaiziVideoGenerateParams {
  userId: string
  imageUrl: string
  prompt?: string
  options: KuaiziGenerateRequestOptions
}

type SeedanceContent = {
  type: 'text' | 'image_url' | 'video_url' | 'audio_url'
  text?: string
  image_url?: { url: string }
  video_url?: { url: string }
  audio_url?: { url: string }
  role?: 'first_frame' | 'last_frame' | 'reference_image' | 'reference_video' | 'reference_audio'
}

type SeedanceOmniReferenceTaskType = 'auto' | 'reference' | 'edit' | 'extend'

const SEEDANCE_MODEL_LIMITS: Record<string, {
  resolutions: readonly string[]
  maxDuration: number
  maxImages: number
  maxVideos: number
  maxAudios: number
}> = {
  'doubao-seedance-2-0-260128': {
    resolutions: ['480p', '720p', '1080p', '4k'],
    maxDuration: 15,
    maxImages: 9,
    maxVideos: 3,
    maxAudios: 3,
  },
  'doubao-seedance-2-0-fast-260128': {
    resolutions: ['480p', '720p', '1080p'],
    maxDuration: 15,
    maxImages: 9,
    maxVideos: 3,
    maxAudios: 3,
  },
  'doubao-seedance-2-0-mini-260615': {
    resolutions: ['480p', '720p', '1080p'],
    maxDuration: 15,
    maxImages: 9,
    maxVideos: 3,
    maxAudios: 3,
  },
  'doubao-seedance-2-5-260628': {
    resolutions: ['480p', '720p', '1080p'],
    maxDuration: 30,
    maxImages: 30,
    maxVideos: 10,
    maxAudios: 10,
  },
}

const SEEDANCE_RATIOS = new Set(['16:9', '4:3', '1:1', '3:4', '9:16', '21:9', 'adaptive'])
const SEEDANCE_25_TASK_TYPES = new Set<SeedanceOmniReferenceTaskType>(['auto', 'reference', 'edit', 'extend'])

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(readString).filter(Boolean)
    : []
}

async function normalizeMediaUrl(value: string, kind: 'video' | 'audio'): Promise<string> {
  const normalized = await normalizeToOriginalMediaUrl(value)
  if (!/^https?:\/\//i.test(normalized)) {
    throw new Error(`KUAIZI_${kind.toUpperCase()}_URL_PUBLIC_REQUIRED`)
  }
  return normalized
}

function optionalInteger(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(`KUAIZI_VIDEO_${field.toUpperCase()}_INVALID`)
  }
  return value
}

function optionalStringArray(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new Error(`KUAIZI_VIDEO_${field.toUpperCase()}_INVALID`)
  return value.map((item, index) => {
    if (typeof item !== 'string' || !item.trim()) {
      throw new Error(`KUAIZI_VIDEO_${field.toUpperCase()}_${index}_INVALID`)
    }
    return item.trim()
  })
}

async function buildKlingRequest(params: KuaiziVideoGenerateParams): Promise<Record<string, unknown>> {
  const prompt = readString(params.prompt) || readString(params.options.prompt)
  const firstFrame = readString(params.imageUrl)
  const lastFrame = readString(params.options.lastFrameImageUrl)
  const referenceImages = await normalizeReferenceImagesForGeneration(stringArray(params.options.referenceImages), {
    context: { provider: params.options.provider, modelId: params.options.modelId },
  })
  const images: Array<{ url: string; role?: string }> = []
  if (firstFrame) images.push({ url: await normalizeToPublicImageUrlForGeneration(firstFrame), role: 'first_frame' })
  if (lastFrame) images.push({ url: await normalizeToPublicImageUrlForGeneration(lastFrame), role: 'end_frame' })
  for (const image of referenceImages) images.push({ url: image })

  const videos = await Promise.all(stringArray(params.options.videos).slice(0, 1).map(async (url) => ({
    url: await normalizeMediaUrl(url, 'video'),
    refer_type: readString(params.options.videoReferType) || 'base',
  })))
  if (!prompt && images.length === 0 && videos.length === 0) {
    throw new Error('KUAIZI_KLING_CONTENT_REQUIRED')
  }
  const resolution = readString(params.options.resolution).toLowerCase()
  const klingMode = readString(params.options.klingMode)
    || (resolution === '4k' ? '4k' : '')
  return {
    model: params.options.modelId,
    ...(prompt ? { prompt } : {}),
    ...(images.length ? { images } : {}),
    ...(videos.length ? { videos } : {}),
    ...(readString(params.options.aspectRatio) ? { aspect_ratio: readString(params.options.aspectRatio) } : {}),
    ...(typeof optionalInteger(params.options.duration, 'duration') === 'number'
      ? { duration: optionalInteger(params.options.duration, 'duration') }
      : {}),
    ...(typeof params.options.generateAudio === 'boolean' ? { generate_audio: params.options.generateAudio } : {}),
    ...(klingMode ? { kling_mode: klingMode } : {}),
  }
}

async function buildHappyHorseRequest(params: KuaiziVideoGenerateParams): Promise<Record<string, unknown>> {
  const prompt = readString(params.prompt) || readString(params.options.prompt)
  const inputs = [params.imageUrl, ...stringArray(params.options.referenceImages)]
    .map(readString)
    .filter(Boolean)
  const images = await normalizeReferenceImagesForGeneration(inputs, {
    context: { provider: params.options.provider, modelId: params.options.modelId },
  })
  if (!prompt && images.length === 0) throw new Error('KUAIZI_HAPPYHORSE_CONTENT_REQUIRED')
  const resolution = readString(params.options.resolution)
  const duration = optionalInteger(params.options.duration, 'duration')
  return {
    model: params.options.modelId,
    ...(prompt ? { prompt } : {}),
    ...(images.length ? { media: images.map((url) => ({ url, type: 'reference_image' })) } : {}),
    ...(resolution ? { resolution: resolution.toUpperCase() } : {}),
    ...(readString(params.options.aspectRatio) ? { ratio: readString(params.options.aspectRatio) } : {}),
    ...(typeof duration === 'number' ? { duration } : {}),
  }
}

async function buildSeedanceRequest(params: KuaiziVideoGenerateParams): Promise<Record<string, unknown>> {
  const modelId = params.options.modelId
  const modelKey = `${params.options.provider}::${modelId}`
  const limits = SEEDANCE_MODEL_LIMITS[modelId]
  if (!limits) throw new Error(`KUAIZI_SEEDANCE_MODEL_UNSUPPORTED: ${modelId}`)
  const isSeedance25 = modelId === 'doubao-seedance-2-5-260628'
  const content: SeedanceContent[] = []
  const prompt = readString(params.prompt) || readString(params.options.prompt)
  if (prompt) content.push({ type: 'text', text: prompt })

  const firstFrame = readString(params.imageUrl)
  const lastFrame = readString(params.options.lastFrameImageUrl)
  const referenceImages = stringArray(params.options.referenceImages)
  if (referenceImages.length && (firstFrame || lastFrame)) {
    throw new Error('KUAIZI_SEEDANCE_REFERENCE_MODE_CONFLICT')
  }
  if (firstFrame) {
    content.push({
      type: 'image_url',
      image_url: { url: await prepareKuaiziSeedanceImage(await normalizeSeedanceImageReference(firstFrame, modelKey)) },
      role: 'first_frame',
    })
  }
  if (lastFrame) {
    if (!firstFrame) throw new Error('KUAIZI_SEEDANCE_FIRST_FRAME_REQUIRED')
    content.push({
      type: 'image_url',
      image_url: { url: await prepareKuaiziSeedanceImage(await normalizeSeedanceImageReference(lastFrame, modelKey)) },
      role: 'last_frame',
    })
  }
  for (const imageUrl of await normalizeSeedanceImageReferences(referenceImages, modelKey)) {
    content.push({ type: 'image_url', image_url: { url: await prepareKuaiziSeedanceImage(imageUrl) }, role: 'reference_image' })
  }
  for (const videoUrl of stringArray(params.options.videos)) {
    content.push({
      type: 'video_url',
      video_url: { url: await normalizeSeedanceMediaReference(videoUrl, modelKey) },
      role: 'reference_video',
    })
  }
  for (const audioUrl of stringArray(params.options.audios)) {
    content.push({
      type: 'audio_url',
      audio_url: { url: await normalizeSeedanceMediaReference(audioUrl, modelKey) },
      role: 'reference_audio',
    })
  }
  if (!content.some((item) => item.type !== 'audio_url')) {
    throw new Error('KUAIZI_SEEDANCE_CONTENT_REQUIRED')
  }

  const duration = optionalInteger(params.options.duration, 'duration')
  const seed = optionalInteger(params.options.seed, 'seed')
  const executionExpiresAfter = optionalInteger(
    params.options.executionExpiresAfter ?? params.options.execution_expires_after,
    'execution_expires_after',
  )
  const resolution = readString(params.options.resolution).toLowerCase()
  if (resolution && !limits.resolutions.includes(resolution)) {
    throw new Error(`KUAIZI_SEEDANCE_RESOLUTION_UNSUPPORTED: ${resolution}`)
  }
  if (duration !== undefined && duration !== -1 && (duration < 4 || duration > limits.maxDuration)) {
    throw new Error(`KUAIZI_SEEDANCE_DURATION_UNSUPPORTED: ${duration}`)
  }
  if (executionExpiresAfter !== undefined && (executionExpiresAfter < 3600 || executionExpiresAfter > 259200)) {
    throw new Error(`KUAIZI_SEEDANCE_EXECUTION_EXPIRES_AFTER_UNSUPPORTED: ${executionExpiresAfter}`)
  }

  const imageCount = content.filter((item) => item.type === 'image_url').length
  const videoCount = content.filter((item) => item.type === 'video_url').length
  const audioCount = content.filter((item) => item.type === 'audio_url').length
  if (imageCount > limits.maxImages) throw new Error(`KUAIZI_SEEDANCE_IMAGES_LIMIT_EXCEEDED: ${imageCount}`)
  if (videoCount > limits.maxVideos) throw new Error(`KUAIZI_SEEDANCE_VIDEOS_LIMIT_EXCEEDED: ${videoCount}`)
  if (audioCount > limits.maxAudios) throw new Error(`KUAIZI_SEEDANCE_AUDIOS_LIMIT_EXCEEDED: ${audioCount}`)

  const hasFirstLastFrame = content.some(
    (item) => item.type === 'image_url' && (item.role === 'first_frame' || item.role === 'last_frame'),
  )
  const promptText = prompt || ''
  const hasReferenceVideo = content.some((item) => item.type === 'video_url')
  const hasEditIntent = /(?:编辑|增加|删除|修改|替换)/.test(promptText)
  const hasExtendIntent = /(?:延长|延续|续写)/.test(promptText)
  const requestedTaskType = readString(
    params.options.omniReferenceTaskType ?? params.options.omni_reference_task_type,
  ) as SeedanceOmniReferenceTaskType | ''
  if (requestedTaskType && (!isSeedance25 || !SEEDANCE_25_TASK_TYPES.has(requestedTaskType))) {
    throw new Error(`KUAIZI_SEEDANCE_OMNI_REFERENCE_TASK_TYPE_UNSUPPORTED: ${requestedTaskType}`)
  }
  const inferredTaskType: SeedanceOmniReferenceTaskType | '' = isSeedance25 && hasReferenceVideo
    ? hasExtendIntent ? 'extend' : hasEditIntent ? 'edit' : ''
    : ''
  const omniReferenceTaskType = requestedTaskType || inferredTaskType
  const constraintTaskType = omniReferenceTaskType === 'auto'
    ? inferredTaskType
    : omniReferenceTaskType
  if ((omniReferenceTaskType === 'edit' || omniReferenceTaskType === 'extend') && !hasReferenceVideo) {
    throw new Error(`KUAIZI_SEEDANCE_${omniReferenceTaskType.toUpperCase()}_VIDEO_REQUIRED`)
  }

  const requestedRatio = readString(params.options.aspectRatio ?? params.options.ratio)
  if (requestedRatio && !SEEDANCE_RATIOS.has(requestedRatio)) {
    throw new Error(`KUAIZI_SEEDANCE_RATIO_UNSUPPORTED: ${requestedRatio}`)
  }
  const forcedAdaptive = isSeedance25 && (
    hasFirstLastFrame
    || constraintTaskType === 'edit'
    || constraintTaskType === 'extend'
    || (hasReferenceVideo && (hasEditIntent || hasExtendIntent))
  )
  const effectiveRatio = forcedAdaptive ? 'adaptive' : requestedRatio
  const effectiveDuration = constraintTaskType === 'edit' ? -1 : duration

  const returnLastFrame = params.options.returnLastFrame ?? params.options.return_last_frame
  const moderationIps = optionalStringArray(
    params.options.moderationIps ?? params.options.moderation_ips,
    'moderation_ips',
  )
  if (moderationIps && moderationIps.length > 5) {
    throw new Error(`KUAIZI_SEEDANCE_MODERATION_IPS_LIMIT_EXCEEDED: ${moderationIps.length}`)
  }
  const safetyIdentifier = readString(params.options.safetyIdentifier ?? params.options.safety_identifier)
  if (safetyIdentifier.length > 64) throw new Error('KUAIZI_SEEDANCE_SAFETY_IDENTIFIER_TOO_LONG')
  const bitrateMode = readString(params.options.bitrateMode ?? params.options.bitrate_mode)
  if (bitrateMode && bitrateMode !== 'standard') {
    throw new Error(`KUAIZI_SEEDANCE_BITRATE_MODE_UNSUPPORTED: ${bitrateMode}`)
  }
  const outputFormat = readString(params.options.outputFormat ?? params.options.output_format).toLowerCase()
  if (outputFormat && outputFormat !== 'mp4') {
    throw new Error(`KUAIZI_SEEDANCE_OUTPUT_FORMAT_UNSUPPORTED: ${outputFormat}`)
  }

  return {
    model: modelId,
    content,
    ...(resolution ? { resolution } : {}),
    ...(effectiveRatio ? { ratio: effectiveRatio } : {}),
    ...(typeof effectiveDuration === 'number' ? { duration: effectiveDuration } : {}),
    ...(typeof seed === 'number' ? { seed } : {}),
    ...(typeof params.options.generateAudio === 'boolean' ? { generate_audio: params.options.generateAudio } : {}),
    ...(typeof params.options.watermark === 'boolean' ? { watermark: params.options.watermark } : {}),
    ...(typeof returnLastFrame === 'boolean' ? { return_last_frame: returnLastFrame } : {}),
    ...(typeof executionExpiresAfter === 'number' ? { execution_expires_after: executionExpiresAfter } : {}),
    ...(moderationIps?.length ? { moderation_options: { ips: moderationIps } } : {}),
    ...(safetyIdentifier ? { safety_identifier: safetyIdentifier } : {}),
    ...(bitrateMode ? { bitrate_mode: bitrateMode } : {}),
    ...(outputFormat ? { output_format: outputFormat } : {}),
    ...(omniReferenceTaskType ? { omni_reference_task_type: omniReferenceTaskType } : {}),
  }
}

export async function generateKuaiziVideo(params: KuaiziVideoGenerateParams): Promise<GenerateResult> {
  const model = getKuaiziModelDefinition(params.options.modelId, 'video')
  const config = await getProviderConfig(params.userId, params.options.provider)
  let payload: unknown
  if (model.family === 'kling') {
    payload = await postKuaiziApiKey({
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      path: '/ai-open-platform-api/v1/kling/video/task/create',
      body: await buildKlingRequest(params),
    })
  } else if (model.family === 'happyhorse') {
    payload = await postKuaiziApiKey({
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      path: '/ai-open-platform-api/v1/happyhorse/video/task/create',
      body: await buildHappyHorseRequest(params),
    })
  } else if (model.family === 'seedance') {
    payload = await requestKuaiziBearer({
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      path: '/ai-open-platform-api/api/v3/contents/generations/tasks',
      method: 'POST',
      body: await buildSeedanceRequest(params),
    })
  } else {
    throw new Error(`KUAIZI_VIDEO_MODEL_UNSUPPORTED: ${model.modelId}`)
  }

  const record = asRecord(payload)
  const taskId = readString(record?.task_id) || readString(record?.id)
  if (!taskId) throw new Error('KUAIZI_VIDEO_TASK_ID_MISSING')
  return {
    success: true,
    async: true,
    requestId: taskId,
    externalId: formatKuaiziExternalId({
      type: 'VIDEO',
      providerId: params.options.provider,
      modelId: model.modelId,
      taskId,
    }),
  }
}
