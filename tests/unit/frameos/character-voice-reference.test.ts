import { describe, expect, it } from 'vitest'
import { characterVoiceMaterialId, withCharacterVoiceMaterial, matchCharacterVoiceFile, validateCharacterAudioFile } from '@/lib/frameos/character-voice-reference'

describe('character card voice pairing', () => {
  it('pairs by normalized file stem while rejecting ambiguous voices', () => {
    expect(matchCharacterVoiceFile('关羽.png', [{ name: '关羽_voice.wav' }])?.name).toBe('关羽_voice.wav')
    expect(matchCharacterVoiceFile('关羽.png', [{ name: '关羽.mp3' }, { name: '关羽.wav' }])).toBeNull()
    expect(matchCharacterVoiceFile('场景.png', [{ name: '关羽.mp3' }])).toBeNull()
  })
  it('adds/removes voice id without deleting other role metadata', () => {
    const metadata = withCharacterVoiceMaterial({ assetCategory: 'character', characterId: 'role-1' }, 'voice-1')
    expect(characterVoiceMaterialId(metadata)).toBe('voice-1')
    expect(withCharacterVoiceMaterial(metadata, null)).toEqual({ assetCategory: 'character', characterId: 'role-1' })
    expect(characterVoiceMaterialId({ voiceMaterialId: 10 })).toBeNull()
  })
  it('prechecks empty/oversized/unsupported files before upload', () => {
    expect(validateCharacterAudioFile({ name: 'a.mp3', type: '', size: 100 })).toBeNull()
    expect(validateCharacterAudioFile({ name: 'a.mp3', type: '', size: 0 })).toContain('50MB')
    expect(validateCharacterAudioFile({ name: 'a.exe', type: '', size: 100 })).toContain('请选择')
    expect(validateCharacterAudioFile({ name: 'a.wav', type: 'audio/wav', size: 50 * 1024 * 1024 + 1 })).toContain('50MB')
  })
})
