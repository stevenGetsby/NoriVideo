import { describe, expect, it } from 'vitest'
import { buildPrompt, getPromptTemplate, PROMPT_IDS } from '@/lib/prompt-i18n'

const SAMPLE_PANELS_JSON = JSON.stringify([
  {
    panel_id: 'panel-1',
    panel_number: 1,
    description: 'Ari turns from the workbench and answers Mina.',
    source_text: 'Ari says they can finish before sunset.',
    source_anchor: { start: 'Ari says', end: 'before sunset.' },
    referenced_assets: {
      characters: ['Ari', 'Mina'],
      location: 'workshop_day',
      props: ['brass_key'],
    },
    video_prompt: 'Close shot, Ari speaks while lifting the brass key.',
    continuity_notes: 'Ari keeps the brass key in the right hand.',
    voice_refs: [{ speaker: 'Ari', source_text: 'We can finish this before sunset.' }],
    scene_type: 'emotion',
    characters: [{ name: 'Ari' }, { name: 'Mina' }],
  },
])

function render(locale: 'zh' | 'en') {
  return buildPrompt({
    promptId: PROMPT_IDS.NP_AGENT_ACTING_DIRECTION,
    locale,
    variables: {
      panels_json: SAMPLE_PANELS_JSON,
      panel_count: '1',
      characters_info: 'Ari: calm maker, voice_trait: focused. Mina: careful listener.',
    },
  })
}

describe('acting direction prompt template', () => {
  it('registers zh and en templates with the FrameOS voice and continuity contract', () => {
    const zh = getPromptTemplate(PROMPT_IDS.NP_AGENT_ACTING_DIRECTION, 'zh')
    const en = getPromptTemplate(PROMPT_IDS.NP_AGENT_ACTING_DIRECTION, 'en')

    for (const template of [zh, en]) {
      expect(template).toContain('source_text')
      expect(template).toContain('source_anchor')
      expect(template).toContain('referenced_assets')
      expect(template).toContain('video_prompt')
      expect(template).toContain('continuity_notes')
      expect(template).toContain('voice_refs')
      expect(template).toContain('dialogue_state')
      expect(template).toContain('lip_sync')
      expect(template).toContain('"name"')
      expect(template).toContain('"acting"')
    }
  })

  it('renders panel and character context without unresolved placeholders', () => {
    for (const rendered of [render('zh'), render('en')]) {
      expect(rendered).toContain('"panel_id":"panel-1"')
      expect(rendered).toContain('"source_text":"Ari says they can finish before sunset."')
      expect(rendered).toContain('"voice_refs":[{"speaker":"Ari"')
      expect(rendered).toContain('Ari: calm maker')
      expect(rendered).not.toContain('{panels_json}')
      expect(rendered).not.toContain('{panel_count}')
      expect(rendered).not.toContain('{characters_info}')
    }
  })
})
