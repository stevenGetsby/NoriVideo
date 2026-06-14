import { describe, expect, it } from 'vitest'
import { buildPrompt, getPromptTemplate, PROMPT_IDS } from '@/lib/prompt-i18n'

const SAMPLE_PANEL_CONTEXT = JSON.stringify({
  panel_id: 'panel-1',
  panel_number: 1,
  description: 'Ari opens the workshop door.',
  source_text: 'Ari opens the workshop door.',
  source_anchor: { start: 'Ari opens', end: 'workshop door.' },
  referenced_assets: { characters: ['Ari'], location: 'workshop_day', props: ['brass_key'] },
  image_prompt: 'Ari at the workshop door.',
  visual_prompt: 'Ari at the workshop door.',
  video_prompt: 'Ari opens the door while the camera slowly pushes in.',
  continuity_notes: 'Ari remains at the same entrance and keeps the brass key visible.',
  voice_refs: [{ speaker: 'Ari', source_text: 'We start here.' }],
  visual_style: 'cinematic workshop realism',
  visual_style_description: 'Natural workshop light and grounded composition.',
})

function render(locale: 'zh' | 'en') {
  return buildPrompt({
    promptId: PROMPT_IDS.NP_AGENT_SHOT_VARIANT_ANALYSIS,
    locale,
    variables: {
      panel_description: 'Ari opens the workshop door.',
      shot_type: 'medium shot',
      camera_move: 'slow push in',
      location: 'workshop_day',
      characters_info: 'Ari, default appearance, entrance slot',
      panel_context_json: SAMPLE_PANEL_CONTEXT,
    },
  })
}

describe('shot variant analysis prompt template', () => {
  it('registers zh and en templates with the FrameOS panel production contract', () => {
    const zh = getPromptTemplate(PROMPT_IDS.NP_AGENT_SHOT_VARIANT_ANALYSIS, 'zh')
    const en = getPromptTemplate(PROMPT_IDS.NP_AGENT_SHOT_VARIANT_ANALYSIS, 'en')

    for (const template of [zh, en]) {
      expect(template).toContain('panel_context_json')
      expect(template).toContain('source_text')
      expect(template).toContain('source_anchor')
      expect(template).toContain('referenced_assets')
      expect(template).toContain('image_prompt')
      expect(template).toContain('visual_prompt')
      expect(template).toContain('video_prompt')
      expect(template).toContain('continuity_notes')
      expect(template).toContain('voice_refs')
      expect(template).toContain('visual_style')
      expect(template).toContain('visual_style_description')
      expect(template).toContain('"image_prompt"')
      expect(template).toContain('"visual_prompt"')
      expect(template).toContain('"referenced_assets"')
      expect(template).toContain('"continuity_notes"')
      expect(template).toContain('shot_type')
      expect(template).toContain('camera_move')
      expect(template).toContain('creative_score')
      expect(template).toContain('source_anchor')
    }
  })

  it('renders panel context without unresolved placeholders', () => {
    for (const rendered of [render('zh'), render('en')]) {
      expect(rendered).toContain('"panel_id":"panel-1"')
      expect(rendered).toContain('"source_anchor":{"start":"Ari opens","end":"workshop door."}')
      expect(rendered).toContain('"referenced_assets":{"characters":["Ari"],"location":"workshop_day","props":["brass_key"]}')
      expect(rendered).not.toContain('{panel_description}')
      expect(rendered).not.toContain('{shot_type}')
      expect(rendered).not.toContain('{camera_move}')
      expect(rendered).not.toContain('{location}')
      expect(rendered).not.toContain('{characters_info}')
      expect(rendered).not.toContain('{panel_context_json}')
    }
  })
})
