import { describe, expect, it } from 'vitest'
import { buildPrompt, getPromptTemplate, PROMPT_IDS } from '@/lib/prompt-i18n'

function render(locale: 'zh' | 'en') {
  return buildPrompt({
    promptId: PROMPT_IDS.NP_AI_STORY_EXPAND,
    locale,
    variables: {
      input: 'A courier returns to a workshop with a brass key and finds the old gate open.',
    },
  })
}

describe('AI story expand prompt template', () => {
  it('registers zh and en templates with FrameOS parse-ready source text requirements', () => {
    const zh = getPromptTemplate(PROMPT_IDS.NP_AI_STORY_EXPAND, 'zh')
    const en = getPromptTemplate(PROMPT_IDS.NP_AI_STORY_EXPAND, 'en')

    for (const template of [zh, en]) {
      expect(template).toContain('source_text')
      expect(template).toContain('episode_split')
      expect(template).toContain('screenplay_conversion')
      expect(template).toContain('asset extraction')
      expect(template).toContain('storyboard generation')
      expect(template).toContain('voice_refs')
      expect(template).toContain('export preflight review')
      expect(template).toContain('characters')
      expect(template).toContain('location')
      expect(template).toContain('props')
    }
  })

  it('renders user input without unresolved placeholders', () => {
    for (const rendered of [render('zh'), render('en')]) {
      expect(rendered).toContain('A courier returns to a workshop with a brass key')
      expect(rendered).not.toContain('{input}')
    }
  })
})
