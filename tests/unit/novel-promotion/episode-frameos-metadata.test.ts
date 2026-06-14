import { describe, expect, it } from 'vitest'
import {
  EPISODE_FRAMEOS_METADATA_KEY,
  buildEpisodeFrameOSMetadata,
  readEpisodeFrameOSMetadataFromSpeakerVoices,
  writeEpisodeFrameOSMetadataToSpeakerVoices,
} from '@/lib/novel-promotion/episode-frameos-metadata'

describe('episode FrameOS metadata', () => {
  it('builds and stores episode split metadata inside speakerVoices private key', () => {
    const metadata = buildEpisodeFrameOSMetadata({
      episode_id: 'episode_001',
      episode_number: 1,
      status: 'draft',
      content_kilo: 0.7,
      estimatedWords: 680,
      source_anchor: { start: 'START_MARKER', end: 'END_MARKER' },
      info_points: 'Ari enters the workshop; brass key changes hands.',
      reasoning: { diagnosis: 'balanced boundary', key_decisions: ['keep workshop exchange together'] },
      scenes: [{ scene_id: 'scene_1', location: 'workshop_day' }],
      analysis: { episodeCount: 1 },
      validation: { isBalanced: true },
    })

    const stored = writeEpisodeFrameOSMetadataToSpeakerVoices(JSON.stringify({
      Narrator: { provider: 'bailian', voiceType: 'qwen-designed', voiceId: 'qwen-tts-vd-001' },
    }), metadata)
    const raw = JSON.parse(stored || '{}') as Record<string, unknown>

    expect(raw[EPISODE_FRAMEOS_METADATA_KEY]).toEqual(metadata)
    expect(raw.Narrator).toEqual({
      provider: 'bailian',
      voiceType: 'qwen-designed',
      voiceId: 'qwen-tts-vd-001',
    })
    expect(readEpisodeFrameOSMetadataFromSpeakerVoices(stored)).toEqual(metadata)
  })
})
