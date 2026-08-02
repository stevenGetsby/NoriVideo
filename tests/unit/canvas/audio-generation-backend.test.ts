import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  audioCapabilitiesForModel,
  normalizeAudioGenerationRequest,
} from '@/lib/audio/generation-contract'
import { implementedAudioModes } from '@/lib/audio/provider'
import { resolveModelCapabilityGenerationOptions } from '@/lib/config-service'

function source(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

describe('provider-neutral canvas audio generation', () => {
  it('declares separate real backends for TTS, music and sound effects', () => {
    expect(audioCapabilitiesForModel('nori::nori-audio')?.modeOptions).toEqual(['tts'])
    expect(audioCapabilitiesForModel('nori::nori-music')?.modeOptions).toEqual(['music', 'sfx'])
    expect(audioCapabilitiesForModel('nori::nori-sfx')?.modeOptions).toEqual(['sfx'])
    expect(implementedAudioModes('bailian', 'qwen3-tts-vd-2026-01-26')).toEqual(['tts'])
    expect(implementedAudioModes('fal', 'fal-ai/stable-audio-25/text-to-audio')).toEqual(['music', 'sfx'])
    expect(implementedAudioModes('fal', 'fal-ai/elevenlabs/sound-effects/v2')).toEqual(['sfx'])
  })

  it('validates mode-specific fields and continuous duration bounds before submission', () => {
    expect(normalizeAudioGenerationRequest({
      modelKey: 'nori::nori-music',
      prompt: 'dark cinematic pulse',
      options: { mode: 'music', duration: 30, genre: '电影配乐' },
    })).toMatchObject({ mode: 'music', durationSeconds: 30, genre: '电影配乐' })

    expect(() => normalizeAudioGenerationRequest({
      modelKey: 'nori::nori-music',
      prompt: 'too long',
      options: { mode: 'music', duration: 191 },
    })).toThrow('1–190 秒')
    expect(() => normalizeAudioGenerationRequest({
      modelKey: 'nori::nori-music',
      prompt: 'fractional stable audio',
      options: { mode: 'music', duration: 12.5 },
    })).toThrow('步进为 1 秒')
    expect(normalizeAudioGenerationRequest({
      modelKey: 'nori::nori-sfx',
      prompt: 'half-second aligned sfx',
      options: { mode: 'sfx', duration: 12.5 },
    }).durationSeconds).toBe(12.5)
    expect(() => normalizeAudioGenerationRequest({
      modelKey: 'nori::nori-audio',
      prompt: 'hello',
      options: { mode: 'tts' },
    })).toThrow('嗓音')
    expect(resolveModelCapabilityGenerationOptions({
      modelType: 'audio',
      modelKey: 'nori::nori-music',
      runtimeSelections: { mode: 'music' },
    })).toEqual({ mode: 'music' })
    expect(() => resolveModelCapabilityGenerationOptions({
      modelType: 'audio',
      modelKey: 'nori::nori-music',
      runtimeSelections: { mode: 'tts' },
    })).toThrow('CAPABILITY_VALUE_NOT_ALLOWED')
  })

  it('keeps UI enablement and API submission tied to advertised model availability', () => {
    const configRoute = source('src/app/api/frameos/generation-config/route.ts')
    const generator = source('src/features/canvas/components/CanvasGenerator.tsx')
    const submitRoute = source('src/app/api/frameos/toolbox/generate/route.ts')
    expect(configRoute).toContain('resolveAudioGenerationAvailability')
    expect(configRoute).toContain('availability.modes')
    expect(configRoute).toContain('durationStepSeconds: duration?.step || null')
    expect(generator).toContain('durationStepSeconds?: number | null')
    expect(generator).toContain('step={audioDurationStep}')
    expect(generator).toContain('alignAudioDuration(current, audioDurationMin, audioDurationMax, audioDurationStep)')
    expect(generator).toContain('AUDIO_MODE_PREFERRED_MODEL_KEYS')
    expect(generator).toContain("sfx: 'nori::nori-sfx'")
    expect(generator).toContain('preferred || candidates[0] || null')
    expect(generator).toContain('尚未配置支持该模式的真实音频模型')
    expect(submitRoute).toContain('TASK_TYPE.TOOLBOX_AUDIO')
    expect(submitRoute).not.toContain('音乐和音效尚未配置真实生成服务')
  })
})
