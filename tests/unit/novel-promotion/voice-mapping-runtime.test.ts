import { describe, expect, it, vi } from 'vitest'
import type { AiStepExecutionInput, AiStepExecutionResult } from '@/lib/ai-runtime'
import {
  buildVoiceMappingPromptPayload,
  runVoiceMappingReview,
} from '@/lib/novel-promotion/voice-mapping-runtime'

describe('FrameOS voice mapping runtime helper', () => {
  it('builds voice mapping prompt payload from characters, dialogue samples, and voice library', () => {
    const payload = buildVoiceMappingPromptPayload({
      characters: [
        {
          id: 'character-1',
          name: 'Ari',
          aliases: JSON.stringify(['A']),
          introduction: 'Workshop lead.',
          profileData: JSON.stringify({
            role_type: 'protagonist',
            gender: 'neutral',
            age_range: 'young adult',
            voice_trait: 'calm and quick',
            representative_line: 'We can finish this.',
            voice_audition_prompt: 'Read with calm urgency.',
            speech_rate: 1,
          }),
          voiceId: null,
          voiceType: null,
          customVoiceUrl: null,
        },
      ],
      episodes: [
        {
          id: 'episode-1',
          name: 'Episode 1',
          voiceLines: [
            {
              id: 'voice-line-1',
              lineIndex: 1,
              speaker: 'Ari',
              content: 'We can finish this.',
              emotionPrompt: 'focused',
              emotionStrength: 0.4,
              matchedPanelId: 'panel-1',
            },
          ],
        },
      ],
      voiceLibrary: [
        {
          id: 'global-voice-1',
          name: 'Clear Young Adult',
          voiceId: 'voice-1',
          voiceType: 'qwen-designed',
          description: 'calm focused voice',
          voicePrompt: 'young adult, focused',
          gender: 'neutral',
          language: 'en',
        },
      ],
    })

    const characters = JSON.parse(payload.characters_json) as { characters: Array<Record<string, unknown>> }
    const dialogue = JSON.parse(payload.dialogue_samples_json) as { samples: Array<Record<string, unknown>> }
    const library = JSON.parse(payload.voice_library_json) as { voices: Array<Record<string, unknown>> }

    expect(characters.characters[0]).toEqual(expect.objectContaining({
      character_id: 'character-1',
      name: 'Ari',
      role_type: 'protagonist',
      voice_trait: 'calm and quick',
      voice_audition_prompt: 'Read with calm urgency.',
    }))
    expect(dialogue.samples[0]).toEqual(expect.objectContaining({
      line_id: 'voice-line-1',
      character: 'Ari',
      matched_panel_id: 'panel-1',
    }))
    expect(library.voices[0]).toEqual(expect.objectContaining({
      library_id: 'global-voice-1',
      voice_id: 'voice-1',
      voice_name: 'Clear Young Adult',
    }))
  })

  it('calls the voice_mapping prompt and returns a character update plan', async () => {
    const executeTextStep = vi.fn(async (_input: AiStepExecutionInput): Promise<AiStepExecutionResult> => ({
      text: JSON.stringify({
        status: 'draft',
        voice_mapping: [
          {
            character: 'Ari',
            character_id: 'character-1',
            voice_source: 'library_match',
            voice_raw_file: '',
            candidates: [
              {
                rank: 1,
                voice_id: 'voice-1',
                voice_name: 'Clear Young Adult',
                reason: 'Matches calm delivery.',
                is_selected: true,
                reference_audio_id: null,
              },
            ],
          },
        ],
        auditions: [],
      }),
      reasoning: 'matched voices',
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      completion: {} as never,
    }))

    const result = await runVoiceMappingReview({
      userId: 'user-1',
      projectId: 'project-1',
      model: 'lumina::gpt-5.5',
      locale: 'zh',
      input: {
        characters: [{ id: 'character-1', name: 'Ari' }],
        voiceLibrary: [{ id: 'global-voice-1', name: 'Clear Young Adult', voiceId: 'voice-1' }],
      },
      executeTextStep,
    })

    expect(result.mapping).toEqual(expect.objectContaining({ status: 'draft' }))
    expect(result.plan.updates).toEqual([
      expect.objectContaining({
        characterId: 'character-1',
        data: expect.objectContaining({
          voiceId: 'voice-1',
          voiceType: 'qwen-designed',
        }),
      }),
    ])
    expect(result.reasoning).toBe('matched voices')
    expect(executeTextStep).toHaveBeenCalledWith(expect.objectContaining({
      model: 'lumina::gpt-5.5',
      action: 'voice_mapping',
      temperature: 0.2,
      messages: [
        expect.objectContaining({
          role: 'user',
          content: expect.stringContaining('"voice_mapping"'),
        }),
      ],
    }))
  })
})

