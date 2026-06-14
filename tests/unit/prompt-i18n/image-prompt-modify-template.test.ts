import { describe, expect, it } from 'vitest'
import { buildPrompt, getPromptTemplate, PROMPT_IDS } from '@/lib/prompt-i18n'

const SAMPLE_PANEL_CONTEXT = JSON.stringify({
  panel_id: 'panel-1',
  source_text: 'Ari opens the workshop door.',
  source_anchor: { start: 'Ari opens', end: 'workshop door.' },
  visual_prompt: 'Ari at the workshop door.',
  continuity_notes: 'Ari remains at the door.',
})

const SAMPLE_REFERENCED_ASSETS = JSON.stringify({
  characters: ['Ari'],
  location: 'workshop_day',
  props: ['brass_key'],
})

function render(locale: 'zh' | 'en') {
  return buildPrompt({
    promptId: PROMPT_IDS.NP_IMAGE_PROMPT_MODIFY,
    locale,
    variables: {
      prompt_input: 'Ari opens the workshop door, workshop_day.',
      video_prompt_input: 'Ari opens the door while the camera slowly pushes in.',
      panel_context_json: SAMPLE_PANEL_CONTEXT,
      referenced_assets_json: SAMPLE_REFERENCED_ASSETS,
      user_input: 'Make the shot more stable and cinematic.',
    },
  })
}

describe('image prompt modify template', () => {
  it('registers zh and en templates with the FrameOS visual prompt contract', () => {
    const zh = getPromptTemplate(PROMPT_IDS.NP_IMAGE_PROMPT_MODIFY, 'zh')
    const en = getPromptTemplate(PROMPT_IDS.NP_IMAGE_PROMPT_MODIFY, 'en')

    for (const template of [zh, en]) {
      expect(template).toContain('panel_context_json')
      expect(template).toContain('referenced_assets_json')
      expect(template).toContain('"image_prompt"')
      expect(template).toContain('"visual_prompt"')
      expect(template).toContain('"video_prompt"')
      expect(template).toContain('"referenced_assets"')
      expect(template).toContain('"continuity_notes"')
      expect(template).toContain('"change_summary"')
      expect(template).toContain('no_visible_text')
    }
  })

  it('renders panel context and referenced assets without unresolved placeholders', () => {
    for (const rendered of [render('zh'), render('en')]) {
      expect(rendered).toContain('"panel_id":"panel-1"')
      expect(rendered).toContain('"location":"workshop_day"')
      expect(rendered).toContain('Make the shot more stable and cinematic.')
      expect(rendered).not.toContain('{prompt_input}')
      expect(rendered).not.toContain('{video_prompt_input}')
      expect(rendered).not.toContain('{panel_context_json}')
      expect(rendered).not.toContain('{referenced_assets_json}')
      expect(rendered).not.toContain('{user_input}')
    }
  })
})
