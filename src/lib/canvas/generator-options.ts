export const CANVAS_IMAGE_ASPECT_RATIOS = [
  '16:9',
  '9:16',
  '21:9',
  '4:3',
  '3:4',
  '1:1',
] as const

export const CANVAS_IMAGE_RESOLUTIONS = ['1K', '2K', '4K'] as const
export const CANVAS_IMAGE_QUALITIES = ['low', 'medium', 'high'] as const
export const CANVAS_PANORAMA_ASPECT_RATIO = '21:9' as const
export const CANVAS_LEGACY_PANORAMA_ASPECT_RATIO = '2:1' as const

export const CANVAS_VIDEO_ASPECT_RATIOS = ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9', 'adaptive'] as const
export const CANVAS_VIDEO_RESOLUTIONS = ['480p', '720p', '1080p', '4k'] as const
export const CANVAS_VIDEO_DURATION_MIN = 4
export const CANVAS_VIDEO_DURATION_MAX = 30
export const CANVAS_VIDEO_FPS_MIN = 1
export const CANVAS_VIDEO_FPS_MAX = 120

export type CanvasImageAspectRatio = (typeof CANVAS_IMAGE_ASPECT_RATIOS)[number]
export type CanvasImageGenerationAspectRatio = CanvasImageAspectRatio
export type CanvasImageResolution = (typeof CANVAS_IMAGE_RESOLUTIONS)[number]
export type CanvasImageQuality = (typeof CANVAS_IMAGE_QUALITIES)[number]
export type CanvasVideoAspectRatio = (typeof CANVAS_VIDEO_ASPECT_RATIOS)[number]
export type CanvasVideoResolution = (typeof CANVAS_VIDEO_RESOLUTIONS)[number]
export type CanvasVideoInputMode = 'text' | 'image' | 'firstlastframe'
export type CanvasVideoEditorMode = CanvasVideoInputMode

export function isSeedance25VideoModelKey(value: unknown): boolean {
  if (typeof value !== 'string') return false
  const modelKey = value.trim().toLowerCase()
  return modelKey === 'nori::norivideo2.5'
    || modelKey === 'kuaizi::doubao-seedance-2-5-260628'
    || modelKey === 'doubao-seedance-2-5-260628'
}

export function canvasVideoAspectRatioOptions(
  modelKey: unknown,
  inputMode: CanvasVideoInputMode,
): readonly CanvasVideoAspectRatio[] {
  if (isSeedance25VideoModelKey(modelKey)) {
    return inputMode === 'firstlastframe' ? ['adaptive'] : CANVAS_VIDEO_ASPECT_RATIOS
  }
  return CANVAS_VIDEO_ASPECT_RATIOS.filter((value) => value !== 'adaptive')
}

export type CanvasImageGenerationOptions = {
  aspectRatio: CanvasImageGenerationAspectRatio
  resolution: CanvasImageResolution
  quality: CanvasImageQuality
}

export type CanvasVideoGenerationOptions = {
  aspectRatio: CanvasVideoAspectRatio
  resolution: CanvasVideoResolution
  duration: number
  generateAudio: boolean
  inputMode: CanvasVideoInputMode
  fps?: number
}

export function resolveSupportedResolution(
  current: string | null | undefined,
  configuredDefault: string | null | undefined,
  supported: readonly string[],
): string {
  const find = (candidate: string | null | undefined) => {
    const normalized = candidate?.trim().toLowerCase() || ''
    return normalized
      ? supported.find((value) => value.toLowerCase() === normalized) || ''
      : ''
  }
  return find(current) || find(configuredDefault) || supported[0] || ''
}

export class CanvasGeneratorOptionError extends Error {
  readonly code = 'CANVAS_GENERATOR_OPTION_INVALID'

  constructor(message: string) {
    super(message)
    this.name = 'CanvasGeneratorOptionError'
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function normalizedText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function choice<T extends string>(params: {
  value: unknown
  values: readonly T[]
  fallback: T
  label: string
  caseInsensitive?: boolean
}): T {
  const raw = normalizedText(params.value)
  if (!raw) return params.fallback
  const selected = params.caseInsensitive
    ? params.values.find((value) => value.toLowerCase() === raw.toLowerCase())
    : params.values.find((value) => value === raw)
  if (selected) return selected
  throw new CanvasGeneratorOptionError(
    `${params.label}仅支持：${params.values.join('、')}。`,
  )
}

export function normalizeCanvasVideoInputMode(value: unknown): CanvasVideoInputMode {
  const raw = normalizedText(value)
  if (!raw || raw === 'text') return 'text'
  if (raw === 'image' || raw === 'firstlastframe') return raw
  throw new CanvasGeneratorOptionError('视频模式仅支持全能参考或首尾帧。')
}

export function canvasVideoEditorMode(value: unknown): CanvasVideoEditorMode {
  return value === 'image' || value === 'firstlastframe' ? value : 'text'
}

/**
 * FrameOS currently creates 720 panorama nodes at 21:9. Older NoriVideo
 * documents used 2:1, so opening one in the editor upgrades its next submit
 * without making the saved node unreadable.
 */
export function canvasPanoramaEditorAspectRatio(value: unknown): typeof CANVAS_PANORAMA_ASPECT_RATIO {
  const ratio = normalizedText(value)
  return ratio === CANVAS_PANORAMA_ASPECT_RATIO ? ratio : CANVAS_PANORAMA_ASPECT_RATIO
}

export function normalizeCanvasImageGenerationOptions(
  value: unknown,
  settings: { allowPanorama?: boolean } = {},
): CanvasImageGenerationOptions {
  const options = record(value)
  const selectedAspectRatio = choice({
    value: options.aspectRatio,
    values: settings.allowPanorama
      ? [...CANVAS_IMAGE_ASPECT_RATIOS, CANVAS_LEGACY_PANORAMA_ASPECT_RATIO]
      : CANVAS_IMAGE_ASPECT_RATIOS,
    fallback: '16:9',
    label: '图片比例',
  })
  return {
    aspectRatio: selectedAspectRatio === CANVAS_LEGACY_PANORAMA_ASPECT_RATIO
      ? CANVAS_PANORAMA_ASPECT_RATIO
      : selectedAspectRatio,
    resolution: choice({
      value: options.resolution,
      values: CANVAS_IMAGE_RESOLUTIONS,
      fallback: '2K',
      label: '图片分辨率',
      caseInsensitive: true,
    }),
    quality: choice({
      value: options.quality,
      values: CANVAS_IMAGE_QUALITIES,
      fallback: 'high',
      label: '图片质量',
      caseInsensitive: true,
    }),
  }
}

export function normalizeCanvasVideoGenerationOptions(
  value: unknown,
  inputMode: unknown,
): CanvasVideoGenerationOptions {
  const options = record(value)
  const rawDuration = options.duration
  const duration = rawDuration === undefined || rawDuration === null || rawDuration === ''
    ? 5
    : Number(rawDuration)
  if (
    !Number.isInteger(duration)
    || duration < CANVAS_VIDEO_DURATION_MIN
    || duration > CANVAS_VIDEO_DURATION_MAX
  ) {
    throw new CanvasGeneratorOptionError(
      `视频时长必须是 ${CANVAS_VIDEO_DURATION_MIN}–${CANVAS_VIDEO_DURATION_MAX} 秒之间的整数。`,
    )
  }
  if (options.generateAudio !== undefined && typeof options.generateAudio !== 'boolean') {
    throw new CanvasGeneratorOptionError('有声视频开关必须是布尔值。')
  }
  const rawFps = options.fps
  const fps = rawFps === undefined || rawFps === null || rawFps === '' ? null : Number(rawFps)
  if (fps !== null && (!Number.isInteger(fps) || fps < CANVAS_VIDEO_FPS_MIN || fps > CANVAS_VIDEO_FPS_MAX)) {
    throw new CanvasGeneratorOptionError(`视频帧率必须是 ${CANVAS_VIDEO_FPS_MIN}–${CANVAS_VIDEO_FPS_MAX} FPS 之间的整数。`)
  }

  return {
    aspectRatio: choice({
      value: options.aspectRatio,
      values: CANVAS_VIDEO_ASPECT_RATIOS,
      fallback: '16:9',
      label: '视频比例',
    }),
    resolution: choice({
      value: options.resolution,
      values: CANVAS_VIDEO_RESOLUTIONS,
      fallback: '720p',
      label: '视频分辨率',
      caseInsensitive: true,
    }),
    duration,
    generateAudio: options.generateAudio === true,
    inputMode: normalizeCanvasVideoInputMode(inputMode),
    ...(fps !== null ? { fps } : {}),
  }
}
