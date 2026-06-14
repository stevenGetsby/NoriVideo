import { describe, expect, it } from 'vitest'
import { buildPrompt, getPromptTemplate, PROMPT_IDS } from '@/lib/prompt-i18n'

const SAMPLE_STORYBOARD_JSON = JSON.stringify([
  {
    storyboardId: 'storyboard-1',
    panelIndex: 0,
    panel_id: 'panel-1',
    panel_number: 1,
    text_segment: 'Ari says they can finish before sunset.',
    source_text: 'Ari raises the brass key and says, 「We can finish this before sunset.」',
    source_anchor: { start: 'Ari raises', end: 'before sunset.' },
    referenced_assets: {
      characters: ['Ari', 'Mina'],
      location: 'workshop_day',
      props: ['brass_key'],
    },
    characters: [{ name: 'Ari' }, { name: 'Mina' }],
    location: 'workshop_day',
    props: ['brass_key'],
    video_prompt: 'Close shot, Ari speaks while lifting the brass key.',
    continuity_notes: 'Ari keeps the brass key in the right hand near the doorway.',
    voice_refs: [{ speaker: 'Ari', source_text: 'We can finish this before sunset.' }],
    scene_type: 'dialogue',
    duration: 4,
  },
])

function render(locale: 'zh' | 'en') {
  return buildPrompt({
    promptId: PROMPT_IDS.NP_VOICE_ANALYSIS,
    locale,
    variables: {
      input: 'Ari raised the brass key and said, 「We can finish this before sunset.」 Mina nodded.',
      characters_lib_name: 'Ari, Mina',
      characters_introduction: 'Ari: focused maker. Mina: careful listener.',
      character_voice_context: 'Ari: voice_trait=calm focus; representative_line=We can finish this before sunset.; voice_audition_prompt=Read with quiet urgency.',
      storyboard_json: SAMPLE_STORYBOARD_JSON,
    },
  })
}

describe('voice analysis prompt template', () => {
  it('registers zh and en templates with FrameOS storyboard voice matching fields', () => {
    const zh = getPromptTemplate(PROMPT_IDS.NP_VOICE_ANALYSIS, 'zh')
    const en = getPromptTemplate(PROMPT_IDS.NP_VOICE_ANALYSIS, 'en')

    for (const template of [zh, en]) {
      expect(template).toContain('lineIndex')
      expect(template).toContain('speaker')
      expect(template).toContain('content')
      expect(template).toContain('emotionStrength')
      expect(template).toContain('matchedPanel')
      expect(template).toContain('storyboardId')
      expect(template).toContain('panelIndex')
      expect(template).toContain('source_text')
      expect(template).toContain('source_anchor')
      expect(template).toContain('referenced_assets')
      expect(template).toContain('voice_refs')
      expect(template).toContain('video_prompt')
      expect(template).toContain('continuity_notes')
      expect(template).toContain('dialogue_state')
      expect(template).toContain('lip_sync')
    }
  })

  it('renders dialogue, character, voice, and storyboard context without unresolved placeholders', () => {
    for (const rendered of [render('zh'), render('en')]) {
      expect(rendered).toContain('Ari raised the brass key')
      expect(rendered).toContain('Ari, Mina')
      expect(rendered).toContain('Ari: focused maker')
      expect(rendered).toContain('voice_trait=calm focus')
      expect(rendered).toContain('"panel_id":"panel-1"')
      expect(rendered).toContain('"referenced_assets":{"characters":["Ari","Mina"],"location":"workshop_day","props":["brass_key"]}')
      expect(rendered).toContain('"voice_refs":[{"speaker":"Ari"')
      expect(rendered).not.toContain('{input}')
      expect(rendered).not.toContain('{characters_lib_name}')
      expect(rendered).not.toContain('{characters_introduction}')
      expect(rendered).not.toContain('{character_voice_context}')
      expect(rendered).not.toContain('{storyboard_json}')
    }
  })
})
