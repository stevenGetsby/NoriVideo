import type {
  CapabilityInputSchema,
  CapabilityMediaInputLimit,
  ModelCapabilities,
} from '@/lib/model-config-contract'
import type { CanvasGenerationReferenceRole } from './generation-reference-contract'

export type CanvasGenerationMediaType = 'image' | 'video' | 'audio'

export type CanvasNormalizedMediaInputLimit = Required<Pick<CapabilityMediaInputLimit, 'min' | 'max'>> & {
  maxTotalDurationSeconds?: number
}

export type CanvasGenerationInputSchema = Required<Pick<CapabilityInputSchema, 'requiredFields'>> &
  Record<CanvasGenerationMediaType, CanvasNormalizedMediaInputLimit>

export type CanvasReferenceMediaSummary = {
  id: string
  title: string
  type: CanvasGenerationMediaType
  previewUrl?: string | null
  durationSeconds?: number | null
  role?: CanvasGenerationReferenceRole
}

const DEFAULT_SCHEMAS: Record<CanvasGenerationMediaType, CanvasGenerationInputSchema> = {
  image: {
    image: { min: 0, max: 9 },
    video: { min: 0, max: 0 },
    audio: { min: 0, max: 0 },
    requiredFields: ['prompt'],
  },
  video: {
    image: { min: 0, max: 9 },
    video: { min: 0, max: 3 },
    audio: { min: 0, max: 3, maxTotalDurationSeconds: 15 },
    requiredFields: ['prompt'],
  },
  audio: {
    image: { min: 0, max: 0 },
    video: { min: 0, max: 0 },
    audio: { min: 0, max: 0 },
    requiredFields: ['prompt', 'voice'],
  },
}

function normalizeLimit(
  fallback: CanvasNormalizedMediaInputLimit,
  value: CapabilityMediaInputLimit | undefined,
): CanvasNormalizedMediaInputLimit {
  const min = typeof value?.min === 'number' && Number.isFinite(value.min)
    ? Math.max(0, Math.floor(value.min))
    : fallback.min
  const maxCandidate = typeof value?.max === 'number' && Number.isFinite(value.max)
    ? Math.max(0, Math.floor(value.max))
    : fallback.max
  const max = Math.max(min, maxCandidate)
  const hasConfiguredDurationLimit = value !== undefined
    && Object.prototype.hasOwnProperty.call(value, 'maxTotalDurationSeconds')
  const maxTotalDurationSeconds = hasConfiguredDurationLimit
    && typeof value?.maxTotalDurationSeconds === 'number'
    && Number.isFinite(value.maxTotalDurationSeconds)
    && value.maxTotalDurationSeconds >= 0
    ? value.maxTotalDurationSeconds
    : value === undefined
      ? fallback.maxTotalDurationSeconds
      : undefined
  return {
    min,
    max,
    ...(typeof maxTotalDurationSeconds === 'number' ? { maxTotalDurationSeconds } : {}),
  }
}

export function resolveCanvasGenerationInputSchema(
  type: CanvasGenerationMediaType,
  capabilities?: ModelCapabilities,
): CanvasGenerationInputSchema {
  const fallback = DEFAULT_SCHEMAS[type]
  const configured = type === 'image'
    ? capabilities?.image?.inputSchema
    : type === 'video'
      ? capabilities?.video?.inputSchema
      : capabilities?.audio?.inputSchema
  return {
    image: normalizeLimit(fallback.image, configured?.image),
    video: normalizeLimit(fallback.video, configured?.video),
    audio: normalizeLimit(fallback.audio, configured?.audio),
    requiredFields: configured?.requiredFields?.length
      ? Array.from(new Set(configured.requiredFields.map((field) => field.trim()).filter(Boolean)))
      : [...fallback.requiredFields],
  }
}

export function firstLastFrameInputSchema(): CanvasGenerationInputSchema {
  return {
    image: { min: 2, max: 2 },
    video: { min: 0, max: 0 },
    audio: { min: 0, max: 0 },
    requiredFields: ['prompt'],
  }
}

export function imageToVideoInputSchema(maxImages = 9): CanvasGenerationInputSchema {
  return {
    image: { min: 1, max: Math.max(1, Math.floor(maxImages)) },
    video: { min: 0, max: 0 },
    audio: { min: 0, max: 0 },
    requiredFields: ['prompt'],
  }
}

const MEDIA_LABELS: Record<CanvasGenerationMediaType, string> = {
  image: '参考图片',
  video: '参考视频',
  audio: '参考音频',
}

export function validateCanvasReferenceMedia(
  schema: CanvasGenerationInputSchema,
  references: CanvasReferenceMediaSummary[],
  options: { enforceMinimums?: boolean; requireKnownAudioDuration?: boolean } = {},
): string[] {
  const errors: string[] = []
  for (const type of ['image', 'video', 'audio'] as const) {
    const count = references.filter((item) => item.type === type).length
    const limit = schema[type]
    if (options.enforceMinimums !== false && count < limit.min) {
      errors.push(`${MEDIA_LABELS[type]}至少需要 ${limit.min} 个。`)
    }
    if (count > limit.max) {
      errors.push(limit.max === 0
        ? `当前模型不支持${MEDIA_LABELS[type]}。`
        : `${MEDIA_LABELS[type]}最多支持 ${limit.max} 个。`)
    }
  }

  const selectedAudios = references.filter((item) => item.type === 'audio')
  const durationLimit = schema.audio.maxTotalDurationSeconds
  if (selectedAudios.length > 0 && typeof durationLimit === 'number') {
    const unknownDuration = selectedAudios.some((item) => (
      typeof item.durationSeconds !== 'number' || !Number.isFinite(item.durationSeconds)
    ))
    if (unknownDuration && options.requireKnownAudioDuration !== false) {
      errors.push('无法读取部分参考音频的时长，请重新上传后再试。')
    } else {
      const total = selectedAudios.reduce((sum, item) => sum + (item.durationSeconds || 0), 0)
      if (total > durationLimit + 0.01) {
        errors.push(`参考音频总时长最多 ${durationLimit} 秒，当前约 ${Math.round(total * 10) / 10} 秒。`)
      }
    }
  }
  return errors
}

/**
 * Seedance reference audio is a conditioning signal, not a standalone video
 * input. Keep this cross-media rule separate from per-type count limits so the
 * toolbox, canvas and API can surface the same actionable error before a paid
 * provider request is created.
 */
export function validateVideoReferenceMediaCombination(
  references: ReadonlyArray<{ type: string }>,
  options: { allowAudioOnly?: boolean } = {},
): string[] {
  const hasAudio = references.some((item) => item.type === 'audio')
  const hasVisualReference = references.some((item) => item.type === 'image' || item.type === 'video')
  return hasAudio && !hasVisualReference && !options.allowAudioOnly
    ? ['参考音频不能单独提交，请至少同时选择 1 张参考图片或 1 个参考视频。']
    : []
}

export function validateCanvasRequiredFields(
  schema: CanvasGenerationInputSchema,
  values: Record<string, unknown>,
): string[] {
  const labels: Record<string, string> = {
    prompt: '提示词',
    voice: '嗓音',
  }
  return schema.requiredFields.flatMap((field) => {
    const value = values[field]
    const present = typeof value === 'string' ? Boolean(value.trim()) : value !== null && value !== undefined
    return present ? [] : [`${labels[field] || field}为必填项。`]
  })
}

export function readMediaDurationSeconds(metadata: unknown): number | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null
  const value = metadata as Record<string, unknown>
  for (const key of ['durationSeconds', 'duration'] as const) {
    const parsed = Number(value[key])
    if (Number.isFinite(parsed) && parsed >= 0) return parsed
  }
  const durationMs = Number(value.durationMs)
  return Number.isFinite(durationMs) && durationMs >= 0 ? durationMs / 1_000 : null
}
