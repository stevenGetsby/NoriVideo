import { describe, expect, it } from 'vitest'
import { buildPrompt, getPromptTemplate, PROMPT_IDS } from '@/lib/prompt-i18n'

const SAMPLE_EXPORT_TARGET = 'Episode 1 delivery package'
const SAMPLE_EPISODES_JSON = JSON.stringify({
  episodes: [
    {
      episode_id: 'ep-1',
      title: 'Sample episode',
      scenes: [
        {
          scene_id: 'scene-1',
          summary: 'A character enters the workshop.',
          source_anchor: { start: 'A character enters', end: 'the workshop.' },
          info_points: ['entry', 'workshop'],
          reasoning: { diagnosis: 'entry beat', key_decisions: ['keep workshop location'] },
          visual_style: 'cinematic workshop realism',
        },
      ],
    },
  ],
})
const SAMPLE_ASSETS_JSON = JSON.stringify({
  characters: [{ asset_id: 'char-1', name: 'Ari', prompt: 'short hair, blue jacket', status: 'confirmed' }],
  environments: [{ asset_id: 'loc-1', name: 'Workshop', base_prompt: 'industrial workshop', status: 'confirmed' }],
})
const SAMPLE_STORYBOARD_JSON = JSON.stringify({
  panels: [
    {
      panel_id: 'panel-1',
      panel_number: 1,
      description: 'Ari opens the workshop door.',
      image_prompt: 'Ari opens the workshop door in workshop_day.',
      visual_prompt: 'Ari opens the workshop door in workshop_day.',
      video_prompt: 'Ari opens the door while the camera slowly pushes in.',
      duration: 4,
      source_text: 'Ari opens the workshop door.',
      source_anchor: { start: 'Ari opens', end: 'workshop door.' },
      referenced_assets: { characters: ['Ari'], location: 'Workshop', props: ['brass_key'] },
      characters: ['Ari'],
      location: 'Workshop',
      props: ['brass_key'],
      continuity_notes: 'Ari remains at the workshop entrance.',
      voice_refs: [{ speaker: 'Ari', source_text: 'We start here.' }],
    },
  ],
})
const SAMPLE_VOICE_JSON = JSON.stringify({
  lines: [{ line_id: 'voice-1', speaker: 'Ari', content: 'We start here.', status: 'generated' }],
})

function render(locale: 'zh' | 'en') {
  return buildPrompt({
    promptId: PROMPT_IDS.NP_EXPORT_PREFLIGHT_REVIEW,
    locale,
    variables: {
      export_target: SAMPLE_EXPORT_TARGET,
      episodes_json: SAMPLE_EPISODES_JSON,
      assets_json: SAMPLE_ASSETS_JSON,
      storyboard_json: SAMPLE_STORYBOARD_JSON,
      voice_json: SAMPLE_VOICE_JSON,
    },
  })
}

describe('export preflight review prompt template', () => {
  it('registers zh and en templates with the expected FrameOS-style output schema', () => {
    const zh = getPromptTemplate(PROMPT_IDS.NP_EXPORT_PREFLIGHT_REVIEW, 'zh')
    const en = getPromptTemplate(PROMPT_IDS.NP_EXPORT_PREFLIGHT_REVIEW, 'en')

    for (const template of [zh, en]) {
      expect(template).toContain('"status"')
      expect(template).toContain('"readiness"')
      expect(template).toContain('"issues"')
      expect(template).toContain('"deliverables"')
      expect(template).toContain('"next_actions"')
      expect(template).toContain('"priority"')
      expect(template).toContain('"evidence"')
      expect(template).toContain('"blocking_reason"')
      expect(template).toContain('source_anchor')
      expect(template).toContain('referenced_assets')
      expect(template).toContain('visual_prompt')
      expect(template).toContain('imagePrompt')
      expect(template).toContain('continuity_notes')
      expect(template).toContain('voice_refs')
      expect(template).toContain('coverage_scenes')
      expect(template).toContain('missing_image')
      expect(template).toContain('missing_video')
      expect(template).toContain('missing_reference')
      expect(template).toContain('missing_prompt')
      expect(template).toContain('duration_risk')
      expect(template).toContain('voice_gap')
      expect(template).toContain('continuity_gap')
    }
  })

  it('renders all production context inputs without leaking unresolved placeholders', () => {
    const zhRendered = render('zh')
    const enRendered = render('en')

    for (const rendered of [zhRendered, enRendered]) {
      expect(rendered).toContain(SAMPLE_EXPORT_TARGET)
      expect(rendered).toContain('"episode_id":"ep-1"')
      expect(rendered).toContain('"asset_id":"char-1"')
      expect(rendered).toContain('"panel_id":"panel-1"')
      expect(rendered).toContain('"visual_prompt":"Ari opens the workshop door in workshop_day."')
      expect(rendered).toContain('"referenced_assets":{"characters":["Ari"],"location":"Workshop","props":["brass_key"]}')
      expect(rendered).toContain('"line_id":"voice-1"')
      expect(rendered).not.toContain('{export_target}')
      expect(rendered).not.toContain('{episodes_json}')
      expect(rendered).not.toContain('{assets_json}')
      expect(rendered).not.toContain('{storyboard_json}')
      expect(rendered).not.toContain('{voice_json}')
    }
  })
})
