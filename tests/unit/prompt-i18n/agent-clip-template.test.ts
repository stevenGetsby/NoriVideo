import { describe, expect, it } from 'vitest'
import { buildPrompt, getPromptTemplate, PROMPT_IDS } from '@/lib/prompt-i18n'

function render(locale: 'zh' | 'en') {
  return buildPrompt({
    promptId: PROMPT_IDS.NP_AGENT_CLIP,
    locale,
    variables: {
      input: 'Ari opens the workshop door. Mina waits near the table with a brass key.',
      locations_lib_name: 'workshop_day',
      characters_lib_name: 'Ari、Mina',
      props_lib_name: 'brass_key',
      characters_introduction: 'Ari is the maker. Mina is the careful listener.',
    },
  })
}

describe('agent clip prompt template', () => {
  it('registers zh and en templates with FrameOS clip metadata fields', () => {
    const zh = getPromptTemplate(PROMPT_IDS.NP_AGENT_CLIP, 'zh')
    const en = getPromptTemplate(PROMPT_IDS.NP_AGENT_CLIP, 'en')

    for (const template of [zh, en]) {
      expect(template).toContain('"start"')
      expect(template).toContain('"end"')
      expect(template).toContain('"summary"')
      expect(template).toContain('"source_anchor"')
      expect(template).toContain('"info_points"')
      expect(template).toContain('"reasoning"')
      expect(template).toContain('"adaptation_decision"')
      expect(template).toContain('"production_function"')
      expect(template).toContain('"self_review"')
      expect(template).toContain('"location"')
      expect(template).toContain('"characters"')
      expect(template).toContain('"props"')
    }
  })

  it('renders source text and asset libraries without unresolved placeholders', () => {
    for (const rendered of [render('zh'), render('en')]) {
      expect(rendered).toContain('Ari opens the workshop door.')
      expect(rendered).toContain('workshop_day')
      expect(rendered).toContain('Ari、Mina')
      expect(rendered).toContain('brass_key')
      expect(rendered).not.toContain('{input}')
      expect(rendered).not.toContain('{locations_lib_name}')
      expect(rendered).not.toContain('{characters_lib_name}')
      expect(rendered).not.toContain('{props_lib_name}')
      expect(rendered).not.toContain('{characters_introduction}')
    }
  })
})
