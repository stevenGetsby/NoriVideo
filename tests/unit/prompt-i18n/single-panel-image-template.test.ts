import { describe, expect, it } from 'vitest'
import { buildPrompt, getPromptTemplate, PROMPT_IDS } from '@/lib/prompt-i18n'

const SAMPLE_PANEL_JSON = JSON.stringify({
  panel: {
    panel_id: 'panel-1',
    description: 'Ari opens the workshop door.',
    image_prompt: 'Ari at the workshop door.',
    visual_prompt: 'Ari at the workshop door.',
    video_prompt: 'Ari opens the door while the camera slowly pushes in.',
    source_text: 'Ari opens the workshop door.',
    source_anchor: { start: 'Ari opens', end: 'workshop door.' },
    referenced_assets: { characters: ['Ari'], location: 'workshop_day', props: ['brass_key'] },
    continuity_notes: 'Ari remains at the entrance.',
    voice_refs: [{ speaker: 'Ari', source_text: 'We start here.' }],
    visual_style: 'cinematic workshop realism',
    visual_style_description: 'Natural workshop light and grounded composition.',
  },
})

function render(locale: 'zh' | 'en') {
  return buildPrompt({
    promptId: PROMPT_IDS.NP_SINGLE_PANEL_IMAGE,
    locale,
    variables: {
      storyboard_text_json_input: SAMPLE_PANEL_JSON,
      source_text: 'Ari opens the workshop door.',
      aspect_ratio: '9:16',
      style: 'cinematic realism',
    },
  })
}

describe('single panel image prompt template', () => {
  it('registers zh and en templates with FrameOS production fields', () => {
    const zh = getPromptTemplate(PROMPT_IDS.NP_SINGLE_PANEL_IMAGE, 'zh')
    const en = getPromptTemplate(PROMPT_IDS.NP_SINGLE_PANEL_IMAGE, 'en')

    for (const template of [zh, en]) {
      expect(template).toContain('referenced_assets')
      expect(template).toContain('image_prompt')
      expect(template).toContain('visual_prompt')
      expect(template).toContain('video_prompt')
      expect(template).toContain('source_anchor')
      expect(template).toContain('continuity_notes')
      expect(template).toContain('voice_refs')
      expect(template).toContain('visual_style')
      expect(template).toContain('visual_style_description')
    }
  })

  it('renders panel context without unresolved placeholders', () => {
    for (const rendered of [render('zh'), render('en')]) {
      expect(rendered).toContain('"panel_id":"panel-1"')
      expect(rendered).toContain('"visual_prompt":"Ari at the workshop door."')
      expect(rendered).toContain('"referenced_assets":{"characters":["Ari"],"location":"workshop_day","props":["brass_key"]}')
      expect(rendered).not.toContain('{storyboard_text_json_input}')
      expect(rendered).not.toContain('{source_text}')
      expect(rendered).not.toContain('{aspect_ratio}')
      expect(rendered).not.toContain('{style}')
    }
  })
})
