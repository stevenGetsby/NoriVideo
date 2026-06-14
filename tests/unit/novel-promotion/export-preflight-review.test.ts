import { describe, expect, it, vi } from 'vitest'
import type { AiStepExecutionInput, AiStepExecutionResult } from '@/lib/ai-runtime'
import {
  buildExportPreflightPromptPayload,
  runExportPreflightReview,
} from '@/lib/novel-promotion/export-preflight-review'
import { writePanelFrameOSMetadataToActingNotes } from '@/lib/novel-promotion/panel-frameos-metadata'

describe('FrameOS export preflight review runtime helper', () => {
  it('builds compact review context from episodes, assets, storyboard panels, and voice lines', () => {
    const payload = buildExportPreflightPromptPayload({
      exportTarget: 'episode delivery',
      episodes: [
        {
          id: 'episode-1',
          episodeNumber: 1,
          name: 'Episode 1',
          description: 'Workshop opening beat.',
          novelText: 'present',
          speakerVoices: JSON.stringify({
            Ari: { provider: 'bailian', voiceType: 'qwen-designed', voiceId: 'voice-ari' },
          }),
          storyboards: [
            {
              id: 'storyboard-1',
              clipId: 'clip-1',
              clip: {
                id: 'clip-1',
                summary: 'Ari enters the workshop.',
                content: 'Ari enters the workshop.',
                location: 'Workshop',
                characters: JSON.stringify(['Ari']),
                props: JSON.stringify(['brass key']),
                screenplay: JSON.stringify({
                  scene_id: 'scene-1',
                  source_anchor: { start: 'Ari enters', end: 'workshop.' },
                }),
              },
              panels: [
                {
                  id: 'panel-1',
                  panelIndex: 0,
                  panelNumber: 1,
                  description: 'Ari opens the door.',
                  location: 'Workshop',
                  characters: JSON.stringify(['Ari']),
                  props: JSON.stringify(['brass key']),
                  duration: 4,
                  imagePrompt: 'Ari at the workshop door.',
                  imageUrl: 'cos://panel-image',
                  videoPrompt: 'Ari opens the door as the camera pushes in.',
                  videoUrl: null,
                  srtSegment: 'Ari opens the door.',
                  actingNotes: writePanelFrameOSMetadataToActingNotes(null, {
                    panel_id: 'frameos-panel-1',
                    panel_number: 1,
                    source_text: 'Ari opens the door.',
                    source_anchor: { start: 'Ari opens', end: 'the door.' },
                    referenced_assets: {
                      characters: ['Ari'],
                      location: 'Workshop',
                      props: ['brass key'],
                    },
                    visual_prompt: 'FrameOS visual prompt for Ari in the workshop.',
                    visual_style: 'grounded short-drama realism',
                    visual_style_description: 'practical daylight, consistent wardrobe',
                    continuity_notes: 'Ari remains at the door.',
                    voice_refs: [{ speaker: 'Ari', line_id: 'voice-line-1' }],
                  }),
                },
              ],
            },
          ],
          voiceLines: [
            {
              id: 'voice-line-1',
              lineIndex: 1,
              speaker: 'Ari',
              content: 'We start here.',
              audioUrl: 'cos://voice-line-1',
              matchedPanelId: 'panel-1',
              matchedStoryboardId: 'storyboard-1',
              matchedPanelIndex: 0,
            },
          ],
        },
      ],
      characters: [
        {
          id: 'character-1',
          name: 'Ari',
          aliases: JSON.stringify(['A']),
          introduction: 'Workshop lead.',
          profileData: JSON.stringify({
            role_type: 'protagonist',
            prompt: 'Ari character sheet.',
            variants: [{ variant_id: 'default', prompt: 'Ari default look.' }],
          }),
          profileConfirmed: true,
          voiceId: 'voice-ari',
          voiceType: 'qwen-designed',
          customVoiceUrl: null,
        },
      ],
      locations: [
        {
          id: 'location-1',
          name: 'Workshop',
          summary: 'Compact workshop.',
          assetKind: 'location',
          selectedImageId: 'location-image-1',
          images: [
            {
              id: 'location-image-1',
              description: 'Workshop plate.',
              availableSlots: JSON.stringify({ slots: ['background'], _frameosAssetMetadata: { environment_id: 'env-1' } }),
              imageUrl: 'cos://location-image',
              isSelected: true,
            },
          ],
        },
      ],
    })

    expect(payload.export_target).toBe('episode delivery')
    expect(JSON.parse(payload.episodes_json)).toEqual(expect.objectContaining({
      episodes: [expect.objectContaining({ episode_id: 'episode-1', title: 'Episode 1' })],
    }))

    const storyboard = JSON.parse(payload.storyboard_json) as { panels: Array<Record<string, unknown>> }
    expect(storyboard.panels[0]).toEqual(expect.objectContaining({
      panel_id: 'frameos-panel-1',
      source_anchor: { start: 'Ari opens', end: 'the door.' },
      referenced_assets: {
        characters: ['Ari'],
        location: 'Workshop',
        props: ['brass key'],
      },
      visual_prompt: 'FrameOS visual prompt for Ari in the workshop.',
      continuity_notes: 'Ari remains at the door.',
      image_url: 'cos://panel-image',
    }))

    const voice = JSON.parse(payload.voice_json) as { lines: Array<Record<string, unknown>> }
    expect(voice.lines[0]).toEqual(expect.objectContaining({
      line_id: 'voice-line-1',
      status: 'generated',
      matched_panel_id: 'panel-1',
    }))
  })

  it('renders the review prompt, calls the configured analysis model, and parses JSON', async () => {
    const executeTextStep = vi.fn(async (_input: AiStepExecutionInput): Promise<AiStepExecutionResult> => ({
      text: JSON.stringify({
        status: 'needs_work',
        readiness: {
          script: 'ready',
          assets: 'ready',
          storyboard: 'ready',
          shots: 'needs_work',
          voice: 'ready',
          export: 'needs_work',
        },
        issues: [],
        deliverables: {
          video_ready: 'partial',
          image_ready: 'ready',
          audio_ready: 'ready',
          manifest_ready: 'partial',
        },
        next_actions: [],
      }),
      reasoning: 'checked production context',
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      completion: {} as never,
    }))

    const result = await runExportPreflightReview({
      userId: 'user-1',
      projectId: 'project-1',
      model: 'lumina::gpt-5.5',
      locale: 'zh',
      input: {
        exportTarget: 'episode delivery',
        episodes: [{ id: 'episode-1', name: 'Episode 1' }],
      },
      executeTextStep,
    })

    expect(result.review).toEqual(expect.objectContaining({ status: 'needs_work' }))
    expect(result.reasoning).toBe('checked production context')
    expect(executeTextStep).toHaveBeenCalledWith(expect.objectContaining({
      model: 'lumina::gpt-5.5',
      action: 'export_preflight_review',
      temperature: 0.2,
      messages: [
        expect.objectContaining({
          role: 'user',
          content: expect.stringContaining('"deliverables"'),
        }),
      ],
      meta: expect.objectContaining({
        stepId: 'export_preflight_review',
      }),
    }))
    const calls = executeTextStep.mock.calls as Array<[AiStepExecutionInput]>
    const call = calls[0]?.[0]
    expect(call?.messages[0]?.content).toContain('episode delivery')
    expect(call?.messages[0]?.content).not.toContain('{export_target}')
  })
})
