import { getProviderConfig } from '@/lib/api-config'
import type { GenerateResult } from '@/lib/generators/base'
import {
  normalizeReferenceImagesForGeneration,
  normalizeToOriginalMediaUrl,
} from '@/lib/media/outbound-image'
import { getTggModelDefinition } from './catalog'
import { asRecord, readFiniteNumber, readString, requestTgg, TGG_CREATE_TIMEOUT_MS } from './client'
import { formatTggExternalId } from './external-id'
import type { TggGenerateRequestOptions, TggModelDefinition } from './types'

export interface TggVideoGenerateParams {
  userId: string
  imageUrl: string
  prompt?: string
  options: TggGenerateRequestOptions
}

// Reference URLs must stay readable through queueing + generation (6 hours).
const TGG_REFERENCE_URL_TTL_SECONDS = 21_600

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(readString).filter(Boolean) : []
}

async function normalizePublicMediaUrl(value: string): Promise<string> {
  const normalized = await normalizeToOriginalMediaUrl(value, { ttlSeconds: TGG_REFERENCE_URL_TTL_SECONDS })
  if (!/^https?:\/\//i.test(normalized)) {
    throw new Error('TGG_MEDIA_URL_PUBLIC_REQUIRED')
  }
  return normalized
}

function requireDuration(model: TggModelDefinition, value: unknown): number {
  if (value === undefined || value === null || value === '') throw new Error('TGG_VIDEO_DURATION_REQUIRED')
  const parsed = readFiniteNumber(value)
  if (parsed === undefined || !Number.isInteger(parsed) || parsed <= 0 || !model.durationOptions.includes(parsed)) {
    throw new Error(`TGG_VIDEO_DURATION_UNSUPPORTED: ${String(value)} (allowed: ${model.durationOptions.join(', ')})`)
  }
  return parsed
}

function optionalRatio(model: TggModelDefinition, value: string): string | undefined {
  const normalized = value.trim()
  const lowered = normalized.toLowerCase()
  if (!normalized || lowered === 'adaptive' || lowered === 'auto') return undefined
  if (!model.ratios.includes(normalized)) {
    throw new Error(`TGG_VIDEO_RATIO_UNSUPPORTED: ${normalized}`)
  }
  return normalized
}

function optionalResolution(model: TggModelDefinition, value: string): string | undefined {
  // The business UI always carries a resolution; models without the field
  // silently omit it instead of failing the generation.
  if (!model.supportsResolution) return undefined
  const normalized = value.trim()
  if (!normalized) return undefined
  if (!model.resolutions.includes(normalized)) {
    throw new Error(`TGG_VIDEO_RESOLUTION_UNSUPPORTED: ${normalized}`)
  }
  return normalized
}

function fileNameFromUrl(url: string): string {
  let pathname = url
  try {
    pathname = new URL(url).pathname
  } catch {
    pathname = url.split(/[?#]/)[0]
  }
  const segment = pathname.split('/').filter(Boolean).pop() || ''
  let decoded = segment
  try {
    decoded = decodeURIComponent(segment)
  } catch {
    decoded = segment
  }
  // Never fabricate an extension: the upstream requires the real file name.
  if (!/\.[A-Za-z0-9]{1,8}$/.test(decoded)) throw new Error('TGG_VIDEO_FILENAME_REQUIRED')
  return decoded
}

export async function generateTggVideo(params: TggVideoGenerateParams): Promise<GenerateResult> {
  const model = getTggModelDefinition(params.options.modelId)
  const prompt = readString(params.prompt) || readString(params.options.prompt)
  if (!prompt) throw new Error('TGG_VIDEO_PROMPT_REQUIRED')

  const seconds = requireDuration(model, params.options.duration)
  const ratio = optionalRatio(model, readString(params.options.aspectRatio) || readString(params.options.ratio))
  const resolution = optionalResolution(model, readString(params.options.resolution))
  const generateAudio = model.supportsGenerateAudio && typeof params.options.generateAudio === 'boolean'
    ? params.options.generateAudio
    : undefined

  // TGG's generic video API documents no last-frame field; fail loudly rather
  // than silently dropping the user's last frame.
  if (readString(params.options.lastFrameImageUrl)) {
    throw new Error('TGG_VIDEO_FIRST_LAST_FRAME_UNSUPPORTED')
  }

  const imageInputs = [readString(params.imageUrl), ...stringArray(params.options.referenceImages)].filter(Boolean)
  const images = await normalizeReferenceImagesForGeneration(imageInputs, {
    context: { provider: params.options.provider, modelId: model.modelId },
    ttlSeconds: TGG_REFERENCE_URL_TTL_SECONDS,
  })
  if (images.length > model.maxImages) {
    throw new Error(`TGG_VIDEO_REFERENCES_LIMIT_EXCEEDED: images=${images.length}`)
  }
  const videos = await Promise.all(stringArray(params.options.videos).map(normalizePublicMediaUrl))
  if (videos.length > model.maxVideos) {
    throw new Error(`TGG_VIDEO_REFERENCES_LIMIT_EXCEEDED: videos=${videos.length}`)
  }
  const audios = await Promise.all(stringArray(params.options.audios).map(normalizePublicMediaUrl))
  if (audios.length > model.maxAudios) {
    throw new Error(`TGG_VIDEO_REFERENCES_LIMIT_EXCEEDED: audios=${audios.length}`)
  }

  const body: Record<string, unknown> = {
    model: model.modelId,
    prompt,
    seconds,
    ...(ratio ? { ratio } : {}),
    ...(resolution ? { resolution } : {}),
    ...(generateAudio !== undefined ? { generate_audio: generateAudio } : {}),
    ...(model.supportsAspectRatioField && ratio ? { aspect_ratio: ratio } : {}),
  }
  if (model.referenceFormat === 'categorized') {
    if (images.length) body.images = images
    if (videos.length) body.videos = videos
    if (audios.length) body.audios = audios
  } else {
    const urls = [...images, ...videos, ...audios]
    if (urls.length) {
      body.files = model.referenceFormat === 'files-named'
        ? urls.map((url) => ({ url, name: fileNameFromUrl(url) }))
        : urls.map((url) => ({ url }))
    }
  }

  const config = await getProviderConfig(params.userId, params.options.provider)
  const payload = await requestTgg({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    path: '/v1/videos',
    method: 'POST',
    body,
    timeoutMs: TGG_CREATE_TIMEOUT_MS,
  })
  const taskId = readString(asRecord(payload)?.id)
  if (!taskId) throw new Error('TGG_VIDEO_TASK_ID_MISSING')

  return {
    success: true,
    async: true,
    requestId: taskId,
    externalId: formatTggExternalId({
      providerId: params.options.provider,
      modelId: model.modelId,
      taskId,
    }),
  }
}
