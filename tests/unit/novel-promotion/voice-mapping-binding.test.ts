import { describe, expect, it } from 'vitest'
import {
  buildSpeakerVoiceMapFromVoiceMapping,
  buildCharacterVoiceMappingUpdates,
  selectVoiceMappingCandidate,
} from '@/lib/novel-promotion/voice-mapping-binding'

describe('FrameOS voice mapping binding', () => {
  it('does not trust library candidate ids as Kuaizi character voices', () => {
    const plan = buildCharacterVoiceMappingUpdates({
      characters: [{ id: 'char-1', name: 'Ari' }],
      mappings: {
        voice_mapping: [
          {
            character: 'Ari',
            character_id: 'character_1',
            voice_source: 'library_match',
            voice_raw_file: '',
            candidates: [
              { rank: 2, voice_id: 'voice-secondary', is_selected: false },
              { rank: 1, voice_id: 'voice-primary', is_selected: true },
            ],
          },
        ],
      },
    })

    expect(plan.updates).toEqual([])
    expect(plan.skipped).toEqual([{ character: 'Ari', characterId: 'character_1', reason: 'missing_voice_id' }])
  })

  it('falls back to the first ranked candidate with a voice id', () => {
    const candidate = selectVoiceMappingCandidate({
      character: 'Ari',
      voice_source: 'library_match',
      candidates: [
        { rank: 3, voice_id: 'voice-late' },
        { rank: 1, voice_id: '' },
        { rank: 2, voice_id: 'voice-early' },
      ],
    })

    expect(candidate).toEqual({ rank: 2, voice_id: 'voice-early' })
  })

  it('maps custom upload source to uploaded voice fields without inventing voice id', () => {
    const plan = buildCharacterVoiceMappingUpdates({
      characters: [{ id: 'char-3', name: 'Nia' }],
      mappings: [
        {
          character: 'Nia',
          character_id: 'character_3',
          voice_source: 'custom_upload',
          voice_raw_file: 'uploaded_voice_nia_1',
          candidates: [],
        },
      ],
    })

    expect(plan.updates).toEqual([
      {
        characterId: 'char-3',
        characterName: 'Nia',
        source: 'custom_upload',
        data: {
          voiceId: null,
          voiceType: 'uploaded',
          customVoiceUrl: 'uploaded_voice_nia_1',
          customVoiceMediaId: null,
        },
      },
    ])
  })

  it('skips unmatched and missing voice ids', () => {
    const plan = buildCharacterVoiceMappingUpdates({
      characters: [
        { id: 'char-1', name: 'Ari' },
        { id: 'char-2', name: 'Mika' },
      ],
      mappings: {
        voice_mapping: [
          {
            character: 'Mika',
            character_id: 'character_2',
            voice_source: 'unmatched',
            voice_raw_file: '',
            candidates: [],
          },
          {
            character: 'Ari',
            character_id: 'character_1',
            voice_source: 'library_match',
            voice_raw_file: '',
            candidates: [{ rank: 1, voice_id: '' }],
          },
        ],
      },
    })

    expect(plan.updates).toEqual([])
    expect(plan.skipped).toEqual([
      { character: 'Mika', characterId: 'character_2', reason: 'unmatched' },
      { character: 'Ari', characterId: 'character_1', reason: 'missing_voice_id' },
    ])
  })

  it('matches by row id, name, and alias without using external ids as local ids', () => {
    const plan = buildCharacterVoiceMappingUpdates({
      characters: [
        { id: 'local-char-1', name: 'Ari' },
        { id: 'local-char-2', name: 'Mika', aliases: JSON.stringify(['M']) },
        { id: 'character_3', name: 'Nia' },
      ],
      mappings: [
        {
          character: 'ignored display name',
          character_id: 'character_3',
          voice_source: 'library_match',
          candidates: [{ rank: 1, voice_id: 'voice-nia' }],
        },
        {
          character: 'M',
          character_id: 'external_mika',
          voice_source: 'library_match',
          candidates: [{ rank: 1, voice_id: 'voice-mika' }],
        },
      ],
    })

    expect(plan.updates).toEqual([])
    expect(plan.skipped).toHaveLength(2)
  })

  it('builds speaker voice bindings from LLM voice_mapping output', () => {
    const plan = buildSpeakerVoiceMapFromVoiceMapping({
      speakers: ['Ari', 'Nia'],
      mappings: {
        voice_mapping: [
          {
            character: 'Ari',
            character_id: 'character_1',
            voice_source: 'library_match',
            candidates: [{ rank: 1, voice_id: 'voice-ari', is_selected: true }],
          },
          {
            character: 'Nia',
            character_id: 'character_3',
            voice_source: 'custom_upload',
            voice_raw_file: 'uploaded_voice_nia_1',
            candidates: [],
          },
          {
            character: 'Mika',
            character_id: 'character_2',
            voice_source: 'unmatched',
            candidates: [],
          },
        ],
      },
    })

    expect(plan.speakerVoices).toEqual({
      Nia: {
        provider: 'kuaizi',
        voiceType: 'uploaded',
        audioUrl: 'uploaded_voice_nia_1',
      },
    })
    expect(plan.skipped).toEqual([
      { speaker: 'Ari', characterId: 'character_1', reason: 'missing_voice_id' },
      { speaker: 'Mika', characterId: 'character_2', reason: 'speaker_not_in_scope' },
    ])
  })
})
