import { describe, expect, it } from 'vitest'
import { buildPrompt, getPromptTemplate, PROMPT_IDS } from '@/lib/prompt-i18n'

const SAMPLE_PANEL_CONTEXT_JSON = JSON.stringify({
  panel_id: 'panel_1',
  panel_number: 1,
  source_text: 'Ari lifts the brass key.',
  source_anchor: { start: 'Ari lifts', end: 'brass key.' },
  image_prompt: 'Ari holds the brass key inside workshop_day.',
  visual_prompt: 'Ari holds the brass key inside workshop_day.',
  video_prompt: 'Ari lifts the brass key as the camera pushes in.',
  continuity_notes: 'Ari keeps the key in her right hand.',
  voice_refs: [{ speaker: 'Ari', line_id: 'voice_1' }],
  visual_style: 'cinematic realism',
  visual_style_description: 'warm practical workshop lighting',
  shot_type: 'medium shot',
  camera_move: 'slow push in',
  duration: 4,
  characters: ['Ari'],
  location: 'workshop_day',
  props: ['brass_key'],
})

const SAMPLE_REFERENCED_ASSETS_JSON = JSON.stringify({
  characters: [{ name: 'Ari', identity_lock: ['short black hair', 'navy jacket'] }],
  location: { name: 'workshop_day', layout: 'central workbench and rear doorway' },
  props: [{ name: 'brass_key', state: 'held in right hand' }],
})

function render(locale: 'zh' | 'en') {
  return buildPrompt({
    promptId: PROMPT_IDS.NP_STORYBOARD_EDIT,
    locale,
    variables: {
      panel_context_json: SAMPLE_PANEL_CONTEXT_JSON,
      referenced_assets_json: SAMPLE_REFERENCED_ASSETS_JSON,
      source_image_context: 'Current frame shows Ari beside the workshop bench.',
      user_input: 'Make the lighting warmer while keeping Ari and the brass key unchanged.',
    },
  })
}

describe('storyboard edit prompt template', () => {
  it('registers zh and en templates with FrameOS redraw continuity requirements', () => {
    const zh = getPromptTemplate(PROMPT_IDS.NP_STORYBOARD_EDIT, 'zh')
    const en = getPromptTemplate(PROMPT_IDS.NP_STORYBOARD_EDIT, 'en')

    for (const template of [zh, en]) {
      expect(template).toContain('referenced_assets')
      expect(template).toContain('panel_context_json')
      expect(template).toContain('referenced_assets_json')
      expect(template).toContain('source_image_context')
      expect(template).toContain('panel_id')
      expect(template).toContain('source_text')
      expect(template).toContain('source_anchor')
      expect(template).toContain('image_prompt')
      expect(template).toContain('visual_prompt')
      expect(template).toContain('video_prompt')
      expect(template).toContain('continuity_notes')
      expect(template).toContain('voice_refs')
      expect(template).toContain('visual_style')
      expect(template).toContain('visual_style_description')
      expect(template).toContain('shot_type')
      expect(template).toContain('camera_move')
      expect(template).toContain('duration')
    }
  })

  it('renders user instruction without unresolved placeholders', () => {
    for (const rendered of [render('zh'), render('en')]) {
      expect(rendered).toContain('Make the lighting warmer while keeping Ari and the brass key unchanged.')
      expect(rendered).toContain('"panel_id":"panel_1"')
      expect(rendered).toContain('"source_anchor":{"start":"Ari lifts","end":"brass key."}')
      expect(rendered).toContain('"characters":[{"name":"Ari","identity_lock":["short black hair","navy jacket"]}]')
      expect(rendered).toContain('Current frame shows Ari beside the workshop bench.')
      expect(rendered).not.toContain('{panel_context_json}')
      expect(rendered).not.toContain('{referenced_assets_json}')
      expect(rendered).not.toContain('{source_image_context}')
      expect(rendered).not.toContain('{user_input}')
    }
  })
})
