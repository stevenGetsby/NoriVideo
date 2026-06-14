import { describe, expect, it } from 'vitest'
import { buildPrompt, getPromptTemplate, PROMPT_IDS } from '@/lib/prompt-i18n'

const SAMPLE_CHARACTERS_JSON = JSON.stringify({
  characters: [
    {
      character_id: 'character_1',
      name: 'Ari',
      role_type: 'protagonist',
      gender: 'neutral',
      age_range: 'young adult',
      voice_trait: 'calm and focused',
      representative_line: 'We can finish this before sunset.',
      voice_audition_prompt: 'Read with calm urgency.',
    },
  ],
})

const SAMPLE_DIALOGUE_JSON = JSON.stringify({
  samples: [
    {
      character: 'Ari',
      content: 'We can finish this before sunset.',
      emotionStrength: 0.35,
    },
  ],
})

const SAMPLE_VOICE_LIBRARY_JSON = JSON.stringify({
  voices: [
    {
      voice_id: 'voice_1',
      voice_name: 'Clear Young Adult',
      gender: 'neutral',
      age_range: 'young adult',
      traits: ['calm', 'focused'],
    },
  ],
})

function render(locale: 'zh' | 'en') {
  return buildPrompt({
    promptId: PROMPT_IDS.NP_VOICE_MAPPING,
    locale,
    variables: {
      characters_json: SAMPLE_CHARACTERS_JSON,
      dialogue_samples_json: SAMPLE_DIALOGUE_JSON,
      voice_library_json: SAMPLE_VOICE_LIBRARY_JSON,
    },
  })
}

describe('voice mapping prompt template', () => {
  it('registers zh and en templates with FrameOS voice mapping schema', () => {
    const zh = getPromptTemplate(PROMPT_IDS.NP_VOICE_MAPPING, 'zh')
    const en = getPromptTemplate(PROMPT_IDS.NP_VOICE_MAPPING, 'en')

    for (const template of [zh, en]) {
      expect(template).toContain('"status"')
      expect(template).toContain('"voice_mapping"')
      expect(template).toContain('"character_id"')
      expect(template).toContain('"role_type"')
      expect(template).toContain('"voice_profile"')
      expect(template).toContain('"voice_source"')
      expect(template).toContain('"custom_upload"')
      expect(template).toContain('"voice_raw_file"')
      expect(template).toContain('"candidates"')
      expect(template).toContain('"reference_audio_id"')
      expect(template).toContain('"auditions"')
      expect(template).toContain('"audition_id"')
    }
  })

  it('renders all voice mapping context inputs', () => {
    const zhRendered = render('zh')
    const enRendered = render('en')

    for (const rendered of [zhRendered, enRendered]) {
      expect(rendered).toContain('"character_id":"character_1"')
      expect(rendered).toContain('"content":"We can finish this before sunset."')
      expect(rendered).toContain('"voice_id":"voice_1"')
      expect(rendered).not.toContain('{characters_json}')
      expect(rendered).not.toContain('{dialogue_samples_json}')
      expect(rendered).not.toContain('{voice_library_json}')
    }
  })
})
