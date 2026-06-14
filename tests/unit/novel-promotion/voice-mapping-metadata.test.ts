import { describe, expect, it } from 'vitest'
import {
  VOICE_MAPPING_FRAMEOS_METADATA_KEY,
  buildVoiceMappingFrameOSMetadata,
  readVoiceMappingFrameOSMetadataFromSpeakerVoices,
  writeVoiceMappingFrameOSMetadataToSpeakerVoices,
} from '@/lib/novel-promotion/voice-mapping-metadata'

describe('FrameOS voice mapping metadata bridge', () => {
  it('builds structured metadata without prompt payload or raw LLM text', () => {
    const metadata = buildVoiceMappingFrameOSMetadata({
      mapping: {
        status: 'draft',
        voice_mapping: [
          {
            character: 'Ari',
            voice_source: 'library_match',
            candidates: [{ rank: 1, voice_id: 'voice-1', is_selected: true }],
          },
        ],
        auditions: [{ character: 'Ari', status: 'pending' }],
      },
      plan: { updates: [{ characterId: 'character-1' }], skipped: [] },
      reasoning: '  matched by vocal age and tone  ',
    })

    expect(metadata).toEqual({
      status: 'draft',
      voice_mapping: [
        {
          character: 'Ari',
          voice_source: 'library_match',
          candidates: [{ rank: 1, voice_id: 'voice-1', is_selected: true }],
        },
      ],
      auditions: [{ character: 'Ari', status: 'pending' }],
      plan: { updates: [{ characterId: 'character-1' }], skipped: [] },
      reasoning: 'matched by vocal age and tone',
    })
    expect(metadata).not.toHaveProperty('promptPayload')
    expect(metadata).not.toHaveProperty('text')
  })

  it('writes and reads metadata while preserving speaker and private episode entries', () => {
    const existing = JSON.stringify({
      _frameosEpisodeMetadata: {
        episode_id: 'episode_001',
        source_anchor: { start: 'START_MARKER', end: 'END_MARKER' },
      },
      Narrator: {
        provider: 'bailian',
        voiceType: 'qwen-designed',
        voiceId: 'voice-existing',
      },
    })
    const metadata = {
      status: 'draft',
      voice_mapping: [{ character: 'Ari', voice_source: 'library_match' }],
      auditions: [{ character: 'Ari', status: 'pending' }],
      plan: { updates: [], skipped: [] },
      reasoning: 'matched',
    }

    const stored = writeVoiceMappingFrameOSMetadataToSpeakerVoices(existing, metadata)
    expect(stored).toBeTruthy()
    const saved = JSON.parse(stored || '{}') as Record<string, unknown>

    expect(saved._frameosEpisodeMetadata).toEqual({
      episode_id: 'episode_001',
      source_anchor: { start: 'START_MARKER', end: 'END_MARKER' },
    })
    expect(saved.Narrator).toEqual({
      provider: 'bailian',
      voiceType: 'qwen-designed',
      voiceId: 'voice-existing',
    })
    expect(saved[VOICE_MAPPING_FRAMEOS_METADATA_KEY]).toEqual(metadata)
    expect(readVoiceMappingFrameOSMetadataFromSpeakerVoices(stored)).toEqual(metadata)
  })

  it('removes metadata without deleting other entries', () => {
    const existing = JSON.stringify({
      [VOICE_MAPPING_FRAMEOS_METADATA_KEY]: { status: 'draft' },
      Ari: {
        provider: 'fal',
        voiceType: 'uploaded',
        audioUrl: 'uploaded_voice_ari_1',
      },
    })

    const stored = writeVoiceMappingFrameOSMetadataToSpeakerVoices(existing, null)
    expect(JSON.parse(stored || '{}')).toEqual({
      Ari: {
        provider: 'fal',
        voiceType: 'uploaded',
        audioUrl: 'uploaded_voice_ari_1',
      },
    })
  })
})
