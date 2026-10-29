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
  it('implements only Kuaizi TTS and does not advertise retired provider backends', () => {
    expect(audioCapabilitiesForModel('nori::nori-audio')?.modeOptions).toEqual(['tts'])
    expect(implementedAudioModes('kuaizi', 'speech-2.8-hd')).toEqual(['tts'])
    expect(implementedAudioModes('bailian', 'qwen3-tts-vd-2026-01-26')).toEqual([])
    expect(implementedAudioModes('fal', 'fal-ai/stable-audio-25/text-to-audio')).toEqual([])
    expect(implementedAudioModes('fal', 'fal-ai/elevenlabs/sound-effects/v2')).toEqual([])
  })

  it('rejects retired music and sfx requests while retaining TTS validation', () => {
    expect(() => normalizeAudioGenerationRequest({
      modelKey: 'nori::nori-music',
      prompt: 'dark cinematic pulse',
      options: { mode: 'music', duration: 30, genre: '电影配乐' },
    })).toThrow('没有声明可执行的生成模式')
    expect(() => normalizeAudioGenerationRequest({
      modelKey: 'nori::nori-sfx',
      prompt: 'short impact',
      options: { mode: 'sfx', duration: 12.5 },
    })).toThrow('没有声明可执行的生成模式')
    expect(normalizeAudioGenerationRequest({
      modelKey: 'nori::nori-audio',
      prompt: 'hello',
      options: { mode: 'tts', voice: 'kuaizi-voice:test' },
    })).toMatchObject({ mode: 'tts', voice: 'kuaizi-voice:test', durationSeconds: null })
    expect(audioCapabilitiesForModel('nori::nori-music')).toBeNull()
    expect(audioCapabilitiesForModel('nori::nori-sfx')).toBeNull()
    expect(() => normalizeAudioGenerationRequest({
      modelKey: 'nori::nori-audio',
      prompt: 'hello',
      options: { mode: 'tts' },
    })).toThrow('嗓音')
    expect(resolveModelCapabilityGenerationOptions({
      modelType: 'audio',
      modelKey: 'nori::nori-audio',
      runtimeSelections: { mode: 'tts' },
    })).toEqual({ mode: 'tts' })
    expect(resolveModelCapabilityGenerationOptions({
      modelType: 'audio',
      modelKey: 'nori::nori-music',
      runtimeSelections: { mode: 'tts' },
    })).toEqual({ mode: 'tts' })
  })

  it('keeps UI enablement and API submission tied to advertised model availability', () => {
    const configRoute = source('src/app/api/frameos/generation-config/route.ts')
    const generator = source('src/features/canvas/components/CanvasGenerator.tsx')
    const submitRoute = source('src/app/api/frameos/toolbox/generate/route.ts')
    expect(configRoute).toContain('resolveAudioGenerationAvailability')
    expect(configRoute).toContain('availability.modes')
    expect(configRoute).toContain('durationStepSeconds: duration?.step || null')
    expect(generator).toContain("type AudioMode = 'tts'")
    expect(generator).toContain("tts: 'nori::nori-audio'")
    expect(generator).not.toContain("value: 'music'")
    expect(generator).not.toContain("value: 'sfx'")
    expect(generator).not.toContain('AUDIO_GENRES')
    expect(generator).not.toContain('AUDIO_SFX_KINDS')
    expect(generator).toContain('preferred || candidates[0] || null')
    expect(generator).toContain('尚未配置支持该模式的真实音频模型')
    expect(submitRoute).toContain('TASK_TYPE.TOOLBOX_AUDIO')
    expect(submitRoute).not.toContain('音乐和音效尚未配置真实生成服务')
  })
})
