import { describe, expect, it } from 'vitest'
import {
  characterVoiceBindingState,
  characterVoiceBindingStats,
} from '@/components/frameos/materials/character-voice'
import type { FrameosMaterialItem } from '@/components/frameos/materials/contracts'

function material(overrides: Partial<FrameosMaterialItem>): Pick<FrameosMaterialItem, 'type' | 'metadata' | 'voice'> {
  return {
    type: overrides.type || 'image',
    metadata: overrides.metadata ?? null,
    voice: overrides.voice ?? null,
  }
}

describe('character voice badge state', () => {
  it('marks character images by resolved voice material or metadata fallback', () => {
    expect(characterVoiceBindingState(material({
      metadata: { assetCategory: 'character' },
      voice: { materialId: 'audio-1', title: '苏晚卿音色', url: '/audio.mp3' },
    }))).toBe('bound')
    expect(characterVoiceBindingState(material({
      metadata: { assetCategory: 'character', voiceMaterialId: 'audio-1' },
    }))).toBe('bound')
    expect(characterVoiceBindingState(material({
      metadata: { assetCategory: 'character' },
    }))).toBe('missing')
  })

  it('ignores non-character images, audio materials, and empty metadata', () => {
    expect(characterVoiceBindingState(material({ metadata: { assetCategory: 'location' } }))).toBeNull()
    expect(characterVoiceBindingState(material({ metadata: null }))).toBeNull()
    expect(characterVoiceBindingState(material({ type: 'audio', metadata: { assetCategory: 'character' } }))).toBeNull()
  })

  it('counts bound and missing voices in the visible selection', () => {
    const stats = characterVoiceBindingStats([
      material({ metadata: { assetCategory: 'character', voiceMaterialId: 'audio-1' } }),
      material({ metadata: { assetCategory: 'character' } }),
      material({ metadata: { assetCategory: 'character' }, voice: { materialId: 'audio-2', title: null, url: null } }),
      material({ metadata: { assetCategory: 'prop' } }),
      material({ type: 'audio', metadata: { assetCategory: 'character' } }),
    ])

    expect(stats).toEqual({ total: 3, bound: 2, missing: 1 })
  })
})
