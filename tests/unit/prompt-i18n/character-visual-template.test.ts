import { describe, expect, it } from 'vitest'
import { buildPrompt, getPromptTemplate, PROMPT_IDS } from '@/lib/prompt-i18n'

const SAMPLE_CHARACTER_PROFILES = JSON.stringify([
  {
    name: 'Ari',
    role_type: 'protagonist',
    description: 'Workshop maker with a calm practical presence.',
    background: 'Ari works in the workshop and is tied to the brass key.',
    identity_lock: ['short dark hair', 'round brass goggles', 'green work coat'],
    coverage_scenes: ['workshop_day'],
    coverage_episodes: ['episode_001'],
    prompt: 'Ari, young adult workshop maker, short dark hair, round brass goggles, green work coat, consistent face and outfit.',
    voice_trait: 'calm and focused',
    representative_line: 'We can finish this before sunset.',
    voice_audition_prompt: 'Read with calm urgency.',
    expected_appearances: [
      { id: 0, change_reason: 'initial appearance', coverage_episodes: ['episode_001'] },
      { id: 1, change_reason: 'rain coat variant', coverage_episodes: ['episode_002'] },
    ],
    variants: [
      {
        variant_id: 'variant_1',
        label: 'initial appearance',
        variant_type: 'default',
        prompt: 'Ari default asset with brass goggles and green work coat.',
        coverage_scenes: ['workshop_day'],
        coverage_episodes: ['episode_001'],
        design_image: null,
      },
      {
        variant_id: 'variant_2',
        label: 'rain coat variant',
        variant_type: 'costume',
        prompt: 'Ari keeps the same face, hair, and brass goggles, adding a dark rain coat.',
        coverage_scenes: ['alley_rain'],
        coverage_episodes: ['episode_002'],
        design_image: null,
      },
    ],
    design_image: null,
  },
])

function render(locale: 'zh' | 'en') {
  return buildPrompt({
    promptId: PROMPT_IDS.NP_AGENT_CHARACTER_VISUAL,
    locale,
    variables: {
      character_profiles: SAMPLE_CHARACTER_PROFILES,
    },
  })
}

describe('character visual prompt template', () => {
  it('registers zh and en templates with the FrameOS character asset contract', () => {
    const zh = getPromptTemplate(PROMPT_IDS.NP_AGENT_CHARACTER_VISUAL, 'zh')
    const en = getPromptTemplate(PROMPT_IDS.NP_AGENT_CHARACTER_VISUAL, 'en')

    for (const template of [zh, en]) {
      expect(template).toContain('identity_lock')
      expect(template).toContain('expected_appearances')
      expect(template).toContain('coverage_scenes')
      expect(template).toContain('coverage_episodes')
      expect(template).toContain('variants')
      expect(template).toContain('variant_id')
      expect(template).toContain('variant_type')
      expect(template).toContain('prompt')
      expect(template).toContain('design_image')
      expect(template).toContain('voice_trait')
      expect(template).toContain('representative_line')
      expect(template).toContain('voice_audition_prompt')
      expect(template).toContain('"appearances"')
      expect(template).toContain('"change_reason"')
      expect(template).toContain('"descriptions"')
    }
  })

  it('renders character profile context without unresolved placeholders', () => {
    for (const rendered of [render('zh'), render('en')]) {
      expect(rendered).toContain('"identity_lock":["short dark hair","round brass goggles","green work coat"]')
      expect(rendered).toContain('"variant_id":"variant_2"')
      expect(rendered).toContain('"voice_trait":"calm and focused"')
      expect(rendered).not.toContain('{character_profiles}')
    }
  })
})
