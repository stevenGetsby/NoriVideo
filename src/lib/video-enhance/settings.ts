export type VideoEnhanceSourceMode = 'file' | 'url'
export type VideoEnhanceResolutionMode = 'preset' | 'limit' | 'original'
export type VideoEnhanceToolVersion = 'standard' | 'professional'

export interface VideoEnhanceSettings {
  sourceMode: VideoEnhanceSourceMode
  toolVersion: VideoEnhanceToolVersion
  scene: 'common' | 'aigc' | 'ugc' | 'short_series' | 'old_film'
  resolutionMode: VideoEnhanceResolutionMode
  resolution: '240p' | '360p' | '480p' | '540p' | '720p' | '1080p' | '2k' | '4k'
  resolutionLimit: string
  fps: string
  showAdvanced: boolean
  submitConcurrency: string
  videoUrlsDraft: string
}

const DEFAULT_VIDEO_ENHANCE_SETTINGS: VideoEnhanceSettings = {
  sourceMode: 'file',
  toolVersion: 'standard',
  scene: 'aigc',
  resolutionMode: 'preset',
  resolution: '1080p',
  resolutionLimit: '',
  fps: '',
  showAdvanced: false,
  submitConcurrency: '3',
  videoUrlsDraft: '',
}

const SOURCE_MODES = new Set<VideoEnhanceSettings['sourceMode']>(['file', 'url'])
const TOOL_VERSIONS = new Set<VideoEnhanceSettings['toolVersion']>(['standard', 'professional'])
const SCENES = new Set<VideoEnhanceSettings['scene']>(['common', 'aigc', 'ugc', 'short_series', 'old_film'])
const RESOLUTION_MODES = new Set<VideoEnhanceSettings['resolutionMode']>(['preset', 'limit', 'original'])
const RESOLUTIONS = new Set<VideoEnhanceSettings['resolution']>(['240p', '360p', '480p', '540p', '720p', '1080p', '2k', '4k'])

function readEnum<T extends string>(value: unknown, allowed: Set<T>, fallback: T): T {
  return typeof value === 'string' && allowed.has(value as T) ? value as T : fallback
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function readText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return ''
  return value.trim().slice(0, maxLength)
}

function readResolutionLimit(value: unknown): string {
  const text = readText(value, 8)
  if (!text) return ''
  const parsed = Number.parseInt(text, 10)
  return Number.isFinite(parsed) && parsed >= 64 && parsed <= 2160 ? String(parsed) : ''
}

function readFps(value: unknown): string {
  const text = readText(value, 8)
  if (!text) return ''
  const parsed = Number.parseFloat(text)
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 120 ? String(parsed) : ''
}

function readSubmitConcurrency(value: unknown): string {
  const text = readText(value, 4)
  const parsed = Number.parseInt(text, 10)
  if (!Number.isFinite(parsed)) return DEFAULT_VIDEO_ENHANCE_SETTINGS.submitConcurrency
  return String(Math.min(Math.max(parsed, 1), 8))
}

function readVideoUrlsDraft(value: unknown): string {
  if (typeof value !== 'string') return ''
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 50)
    .map((line) => line.slice(0, 2048))
  return lines.join('\n').slice(0, 10000)
}

export function normalizeVideoEnhanceSettings(value: unknown): VideoEnhanceSettings {
  const raw = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Partial<Record<keyof VideoEnhanceSettings, unknown>>
    : {}

  return {
    sourceMode: readEnum(raw.sourceMode, SOURCE_MODES, DEFAULT_VIDEO_ENHANCE_SETTINGS.sourceMode),
    toolVersion: readEnum(raw.toolVersion, TOOL_VERSIONS, DEFAULT_VIDEO_ENHANCE_SETTINGS.toolVersion),
    scene: readEnum(raw.scene, SCENES, DEFAULT_VIDEO_ENHANCE_SETTINGS.scene),
    resolutionMode: readEnum(raw.resolutionMode, RESOLUTION_MODES, DEFAULT_VIDEO_ENHANCE_SETTINGS.resolutionMode),
    resolution: readEnum(raw.resolution, RESOLUTIONS, DEFAULT_VIDEO_ENHANCE_SETTINGS.resolution),
    resolutionLimit: readResolutionLimit(raw.resolutionLimit),
    fps: readFps(raw.fps),
    showAdvanced: readBoolean(raw.showAdvanced, DEFAULT_VIDEO_ENHANCE_SETTINGS.showAdvanced),
    submitConcurrency: readSubmitConcurrency(raw.submitConcurrency),
    videoUrlsDraft: readVideoUrlsDraft(raw.videoUrlsDraft),
  }
}
