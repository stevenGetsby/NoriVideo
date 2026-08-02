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
      image_url: { url: await normalizeToPublicImageUrlForGeneration(firstFrame) },
      role: 'first_frame',
    })
  }
  if (lastFrame) {
    if (!firstFrame) throw new Error('KUAIZI_SEEDANCE_FIRST_FRAME_REQUIRED')
    content.push({
      type: 'image_url',
      image_url: { url: await normalizeToPublicImageUrlForGeneration(lastFrame) },
      role: 'last_frame',
    })
  }
  for (const imageUrl of await normalizeReferenceImagesForGeneration(referenceImages, {
    context: { provider: params.options.provider, modelId: params.options.modelId },
  })) {
    content.push({ type: 'image_url', image_url: { url: imageUrl }, role: 'reference_image' })
  }
  for (const videoUrl of stringArray(params.options.videos)) {
    content.push({
      type: 'video_url',
      video_url: { url: await normalizeMediaUrl(videoUrl, 'video') },
      role: 'reference_video',
    })
  }
  for (const audioUrl of stringArray(params.options.audios)) {
    content.push({
      type: 'audio_url',
      audio_url: { url: await normalizeMediaUrl(audioUrl, 'audio') },
      role: 'reference_audio',
    })
  }
  if (content.length === 0) throw new Error('KUAIZI_SEEDANCE_CONTENT_REQUIRED')

  const duration = optionalInteger(params.options.duration, 'duration')
  const frames = optionalInteger(params.options.frames, 'frames')
  const seed = optionalInteger(params.options.seed, 'seed')
  const resolution = readString(params.options.resolution).toLowerCase()
  return {
    model: params.options.modelId,
    content,
    ...(resolution ? { resolution } : {}),
    ...(readString(params.options.aspectRatio) ? { ratio: readString(params.options.aspectRatio) } : {}),
    ...(typeof duration === 'number' ? { duration } : {}),
    ...(typeof frames === 'number' ? { frames } : {}),
    ...(typeof seed === 'number' ? { seed } : {}),
    ...(typeof params.options.generateAudio === 'boolean' ? { generate_audio: params.options.generateAudio } : {}),
    ...(typeof params.options.watermark === 'boolean' ? { watermark: params.options.watermark } : {}),
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
