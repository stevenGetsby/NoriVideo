import { describe, expect, it } from 'vitest'
import { buildPrompt, getPromptTemplate, PROMPT_IDS } from '@/lib/prompt-i18n'

const SAMPLE_PREV_PANEL_JSON = JSON.stringify({
  panel_id: 'panel_1',
  panel_number: 1,
  description: 'Ari lifts the brass key near the workshop door.',
  source_text: 'Ari lifts the brass key.',
  source_anchor: { start: 'Ari lifts', end: 'brass key.' },
  referenced_assets: { characters: ['Ari'], location: 'workshop_day', props: ['brass_key'] },
  video_prompt: 'A young woman lifts the brass key near the workshop door, camera slowly pushes in.',
  continuity_notes: 'Ari is beside the rear doorway holding the key.',
})

const SAMPLE_NEXT_PANEL_JSON = JSON.stringify({
  panel_id: 'panel_2',
  panel_number: 2,
  description: 'Ari steps toward the central workbench.',
  source_text: 'Ari steps toward the workbench.',
  source_anchor: { start: 'Ari steps', end: 'workbench.' },
  referenced_assets: { characters: ['Ari'], location: 'workshop_day', props: ['brass_key'] },
  video_prompt: 'A young woman walks toward the workbench while keeping the brass key visible.',
  continuity_notes: 'Ari moves from the rear doorway toward the central workbench.',
})

function render(locale: 'zh' | 'en') {
  return buildPrompt({
    promptId: PROMPT_IDS.NP_AGENT_STORYBOARD_INSERT,
    locale,
    variables: {
      prev_panel_json: SAMPLE_PREV_PANEL_JSON,
      next_panel_json: SAMPLE_NEXT_PANEL_JSON,
      user_input: 'Bridge the movement without adding a new event.',
      characters_full_description: 'Ari: young woman, short black hair, navy jacket',
      locations_description: 'workshop_day: available slot: the open path between rear doorway and central workbench',
      props_description: 'brass_key: small brass key held in Ari right hand',
    },
  })
}

describe('storyboard insert prompt template', () => {
  it('requires FrameOS video prompt bridge grammar in zh and en templates', () => {
    const zh = getPromptTemplate(PROMPT_IDS.NP_AGENT_STORYBOARD_INSERT, 'zh')
    const en = getPromptTemplate(PROMPT_IDS.NP_AGENT_STORYBOARD_INSERT, 'en')

    for (const template of [zh, en]) {
      expect(template).toContain('"panel_id"')
      expect(template).toContain('"source_anchor"')
      expect(template).toContain('"referenced_assets"')
      expect(template).toContain('"image_prompt"')
      expect(template).toContain('"visual_prompt"')
      expect(template).toContain('"video_prompt"')
      expect(template).toContain('visual subject')
      expect(template).toContain('start/end state')
      expect(template).toContain('continuity')
      expect(template).toContain('voice_refs')
      expect(template).toContain('duration')
    }
  })

  it('renders previous and next panel context without unresolved placeholders', () => {
    for (const rendered of [render('zh'), render('en')]) {
      expect(rendered).toContain('"panel_id":"panel_1"')
      expect(rendered).toContain('"panel_id":"panel_2"')
      expect(rendered).toContain('Bridge the movement without adding a new event.')
      expect(rendered).toContain('workshop_day: available slot')
      expect(rendered).not.toContain('{prev_panel_json}')
      expect(rendered).not.toContain('{next_panel_json}')
      expect(rendered).not.toContain('{user_input}')
      expect(rendered).not.toContain('{characters_full_description}')
      expect(rendered).not.toContain('{locations_description}')
      expect(rendered).not.toContain('{props_description}')
    }
  })
})
