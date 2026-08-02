import type { AudioCapabilities, ModelCapabilities } from '@/lib/model-config-contract'
import { resolveBuiltinCapabilitiesByModelKey } from '@/lib/model-capabilities/lookup'

export const AUDIO_GENERATION_MODES = ['music', 'tts', 'sfx'] as const
export type AudioGenerationMode = (typeof AUDIO_GENERATION_MODES)[number]

export type AudioGenerationRequest = {
  mode: AudioGenerationMode
  prompt: string
  voice: string | null
  durationSeconds: number | null
  genre: string | null
  sfxKind: string | null
}

export type AudioGenerationOptionsInput = {
  mode?: unknown
  voice?: unknown
  duration?: unknown
  genre?: unknown
  sfxKind?: unknown
}

function compact(value: unknown, max = 1_000): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function isAudioMode(value: unknown): value is AudioGenerationMode {
  return typeof value === 'string' && AUDIO_GENERATION_MODES.includes(value as AudioGenerationMode)
}

export function audioCapabilitiesForModel(modelKey: string): AudioCapabilities | null {
  return resolveBuiltinCapabilitiesByModelKey('audio', modelKey)?.audio || null
}

export function declaredAudioModes(capabilities: ModelCapabilities | AudioCapabilities | null | undefined): AudioGenerationMode[] {
  const audio: AudioCapabilities | null | undefined = capabilities && 'audio' in capabilities
    ? capabilities.audio
    : capabilities as AudioCapabilities | null | undefined
  const raw = audio?.modeOptions
  if (!Array.isArray(raw)) return []
  return Array.from(new Set(raw.filter(isAudioMode)))
}

export function audioDurationBounds(capabilities: AudioCapabilities | null | undefined): {
  min: number
  max: number
  step: number | null
  options: number[] | null
} | null {
  if (!capabilities) return null
  const options = Array.isArray(capabilities.durationOptions)
    ? capabilities.durationOptions.filter((value) => Number.isFinite(value) && value > 0)
    : []
  if (options.length > 0) {
    return { min: Math.min(...options), max: Math.max(...options), step: null, options }
  }
  const min = capabilities.minDurationSeconds
  const max = capabilities.maxDurationSeconds
  if (!Number.isFinite(min) || !Number.isFinite(max) || Number(min) <= 0 || Number(max) < Number(min)) return null
  const step = Number(capabilities.durationStepSeconds)
  return { min: Number(min), max: Number(max), step: Number.isFinite(step) && step > 0 ? step : null, options: null }
}

/**
 * Normalize and validate the provider-neutral audio request before a task is
 * created. Music/SFX durations must be explicitly declared by the exact model;
 * a missing capability never silently falls back to an invented provider value.
 */
export function normalizeAudioGenerationRequest(input: {
  modelKey: string
  prompt: unknown
  options: AudioGenerationOptionsInput
  capabilities?: AudioCapabilities | null
}): AudioGenerationRequest {
  const prompt = compact(input.prompt, 30_000)
  if (!prompt) throw new Error('音频生成提示词不能为空。')

  const capabilities = input.capabilities === undefined
    ? audioCapabilitiesForModel(input.modelKey)
    : input.capabilities
  const modes = declaredAudioModes(capabilities)
  if (modes.length === 0) {
    throw new Error('当前音频模型没有声明可执行的生成模式。')
  }

  const mode = isAudioMode(input.options.mode) ? input.options.mode : modes[0]
  if (!modes.includes(mode)) {
    throw new Error(`当前音频模型不支持“${mode}”模式。`)
  }

  const voice = compact(input.options.voice, 240) || null
  const genre = compact(input.options.genre, 240) || null
  const sfxKind = compact(input.options.sfxKind, 240) || null
  if (mode === 'tts' && !voice) throw new Error('配音模式需要选择或填写嗓音。')

  if (mode === 'tts') {
    return { mode, prompt, voice, durationSeconds: null, genre, sfxKind }
  }

  const duration = Number(input.options.duration)
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('音乐或音效时长必须是有效秒数。')
  const bounds = audioDurationBounds(capabilities)
  if (!bounds) throw new Error('当前音频模型没有声明可执行的时长范围。')
  if (duration < bounds.min || duration > bounds.max) {
    throw new Error(`当前音频模型仅支持 ${bounds.min}–${bounds.max} 秒。`)
  }
  if (bounds.options && !bounds.options.includes(duration)) {
    throw new Error(`当前音频模型不支持 ${duration} 秒；可选值为 ${bounds.options.join('、')} 秒。`)
  }
  if (bounds.step) {
    const stepOffset = (duration - bounds.min) / bounds.step
    if (Math.abs(stepOffset - Math.round(stepOffset)) > 1e-9) {
      throw new Error(`当前音频模型的时长步进为 ${bounds.step} 秒。`)
    }
  }

  return { mode, prompt, voice, durationSeconds: duration, genre, sfxKind }
}
