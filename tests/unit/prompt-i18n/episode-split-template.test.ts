import { describe, expect, it } from 'vitest'
import { buildPrompt, getPromptTemplate, PROMPT_IDS } from '@/lib/prompt-i18n'

function render(locale: 'zh' | 'en') {
  return buildPrompt({
    promptId: PROMPT_IDS.NP_EPISODE_SPLIT,
    locale,
    variables: {
      CONTENT: 'Ari enters the workshop. Mina gives Ari the brass key. At night, they leave through the alley.',
    },
  })
}

describe('episode split prompt template', () => {
  it('registers zh and en templates with FrameOS episode metadata fields', () => {
    const zh = getPromptTemplate(PROMPT_IDS.NP_EPISODE_SPLIT, 'zh')
    const en = getPromptTemplate(PROMPT_IDS.NP_EPISODE_SPLIT, 'en')

    for (const template of [zh, en]) {
      expect(template).toContain('"status"')
      expect(template).toContain('"steps"')
      expect(template).toContain('"default_visual_style"')
      expect(template).toContain('"script_kilo"')
      expect(template).toContain('"adapted_kilo"')
      expect(template).toContain('"analysis"')
      expect(template).toContain('"items"')
      expect(template).toContain('"episode_id"')
      expect(template).toContain('"episode_number"')
      expect(template).toContain('"content"')
      expect(template).toContain('"content_kilo"')
      expect(template).toContain('"startMarker"')
      expect(template).toContain('"endMarker"')
      expect(template).toContain('"source_anchor"')
      expect(template).toContain('"info_points"')
      expect(template).toContain('"reasoning"')
      expect(template).toContain('"diagnosis"')
      expect(template).toContain('"key_decisions"')
      expect(template).toContain('"scenes"')
      expect(template).toContain('"scene_id"')
      expect(template).toContain('"visual_style_description"')
      expect(template).toContain('"visual_style_confirmed"')
      expect(template).toContain('"validation"')
    }
  })

  it('renders content without unresolved placeholders', () => {
    for (const rendered of [render('zh'), render('en')]) {
      expect(rendered).toContain('Ari enters the workshop.')
      expect(rendered).not.toContain('{CONTENT}')
      expect(rendered).not.toContain('{{CONTENT}}')
    }
  })
})
