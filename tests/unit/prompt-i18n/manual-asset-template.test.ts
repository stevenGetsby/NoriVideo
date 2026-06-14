import { describe, expect, it } from 'vitest'
import { buildPrompt, getPromptTemplate, PROMPT_IDS } from '@/lib/prompt-i18n'

function renderCharacterCreate(locale: 'zh' | 'en') {
  return buildPrompt({
    promptId: PROMPT_IDS.NP_CHARACTER_CREATE,
    locale,
    variables: {
      user_input: 'Create a practical workshop courier with a fixed green coat.',
    },
  })
}

function renderCharacterModify(locale: 'zh' | 'en') {
  return buildPrompt({
    promptId: PROMPT_IDS.NP_CHARACTER_MODIFY,
    locale,
    variables: {
      character_input: 'Ari, young adult courier, fixed green coat, brass goggles, brown boots.',
      user_input: 'Change the coat to a rain-ready version.',
    },
  })
}

function renderCharacterDescriptionUpdate(locale: 'zh' | 'en') {
  return buildPrompt({
    promptId: PROMPT_IDS.NP_CHARACTER_DESCRIPTION_UPDATE,
    locale,
    variables: {
      original_description: 'Ari, young adult courier, fixed green coat, brass goggles, brown boots.',
      modify_instruction: 'Add a rain hood while preserving the face and goggles.',
      image_context: '',
    },
  })
}

function renderCharacterRegenerate(locale: 'zh' | 'en') {
  return buildPrompt({
    promptId: PROMPT_IDS.NP_CHARACTER_REGENERATE,
    locale,
    variables: {
      character_name: 'Ari',
      current_descriptions: 'Ari, young adult courier, fixed green coat, brass goggles, brown boots.',
      change_reason: 'rain disguise variant',
      novel_text: 'Ari stays the same courier while crossing the rainy alley.',
    },
  })
}

function renderLocationCreate(locale: 'zh' | 'en') {
  return buildPrompt({
    promptId: PROMPT_IDS.NP_LOCATION_CREATE,
    locale,
    variables: {
      user_input: 'Create a small repair workshop with a visible rear entrance.',
    },
  })
}

function renderLocationModify(locale: 'zh' | 'en') {
  return buildPrompt({
    promptId: PROMPT_IDS.NP_LOCATION_MODIFY,
    locale,
    variables: {
      location_name: 'workshop_day',
      location_input: '[workshop_day] A repair workshop with benches, a rear entrance, and high shelves.',
      user_input: 'Add rain visible beyond the rear entrance.',
    },
  })
}

function renderLocationDescriptionUpdate(locale: 'zh' | 'en') {
  return buildPrompt({
    promptId: PROMPT_IDS.NP_LOCATION_DESCRIPTION_UPDATE,
    locale,
    variables: {
      location_name: 'workshop_day',
      original_description: '[workshop_day] A repair workshop with benches, a rear entrance, and high shelves.',
      modify_instruction: 'Make the center bench cleaner.',
      image_context: '',
    },
  })
}

function renderLocationRegenerate(locale: 'zh' | 'en') {
  return buildPrompt({
    promptId: PROMPT_IDS.NP_LOCATION_REGENERATE,
    locale,
    variables: {
      location_name: 'workshop_day',
      current_descriptions: '[workshop_day] A repair workshop with benches, a rear entrance, and high shelves.',
    },
  })
}

function renderPropDescriptionUpdate(locale: 'zh' | 'en') {
  return buildPrompt({
    promptId: PROMPT_IDS.NP_PROP_DESCRIPTION_UPDATE,
    locale,
    variables: {
      prop_name: 'brass_key',
      original_description: 'Small brass key with a round bow and worn teeth.',
      modify_instruction: 'Add a thin red thread loop.',
      image_context: '',
    },
  })
}

describe('manual asset prompt templates', () => {
  it('registers character create, update, and regenerate templates with the FrameOS character asset contract', () => {
    const templates = [
      getPromptTemplate(PROMPT_IDS.NP_CHARACTER_CREATE, 'zh'),
      getPromptTemplate(PROMPT_IDS.NP_CHARACTER_CREATE, 'en'),
      getPromptTemplate(PROMPT_IDS.NP_CHARACTER_MODIFY, 'zh'),
      getPromptTemplate(PROMPT_IDS.NP_CHARACTER_MODIFY, 'en'),
      getPromptTemplate(PROMPT_IDS.NP_CHARACTER_DESCRIPTION_UPDATE, 'zh'),
      getPromptTemplate(PROMPT_IDS.NP_CHARACTER_DESCRIPTION_UPDATE, 'en'),
      getPromptTemplate(PROMPT_IDS.NP_CHARACTER_REGENERATE, 'zh'),
      getPromptTemplate(PROMPT_IDS.NP_CHARACTER_REGENERATE, 'en'),
    ]

    for (const template of templates) {
      expect(template).toContain('identity_lock')
      expect(template).toContain('coverage_scenes')
      expect(template).toContain('coverage_episodes')
      expect(template).toContain('variants')
      expect(template).toContain('design_image')
    }

    expect(getPromptTemplate(PROMPT_IDS.NP_CHARACTER_CREATE, 'en')).toContain('"prompt"')
    expect(getPromptTemplate(PROMPT_IDS.NP_CHARACTER_MODIFY, 'en')).toContain('"prompt"')
    expect(getPromptTemplate(PROMPT_IDS.NP_CHARACTER_DESCRIPTION_UPDATE, 'en')).toContain('"prompt"')
    expect(getPromptTemplate(PROMPT_IDS.NP_CHARACTER_REGENERATE, 'en')).toContain('"descriptions"')
  })

  it('registers location create, update, and regenerate templates with the FrameOS environment asset contract', () => {
    const templates = [
      getPromptTemplate(PROMPT_IDS.NP_LOCATION_CREATE, 'zh'),
      getPromptTemplate(PROMPT_IDS.NP_LOCATION_CREATE, 'en'),
      getPromptTemplate(PROMPT_IDS.NP_LOCATION_MODIFY, 'zh'),
      getPromptTemplate(PROMPT_IDS.NP_LOCATION_MODIFY, 'en'),
      getPromptTemplate(PROMPT_IDS.NP_LOCATION_DESCRIPTION_UPDATE, 'zh'),
      getPromptTemplate(PROMPT_IDS.NP_LOCATION_DESCRIPTION_UPDATE, 'en'),
      getPromptTemplate(PROMPT_IDS.NP_LOCATION_REGENERATE, 'zh'),
      getPromptTemplate(PROMPT_IDS.NP_LOCATION_REGENERATE, 'en'),
    ]

    for (const template of templates) {
      expect(template).toContain('summary')
      expect(template).toContain('description')
      expect(template).toContain('background')
      expect(template).toContain('entrance')
      expect(template).toContain('mood')
      expect(template).toContain('base_ambience')
      expect(template).toContain('coverage_scenes')
      expect(template).toContain('coverage_episodes')
      expect(template).toContain('variants')
      expect(template).toContain('environment_id')
      expect(template).toContain('design_image')
      expect(template).toContain('available_slots')
    }
  })

  it('registers prop description update with the FrameOS prop asset contract', () => {
    const templates = [
      getPromptTemplate(PROMPT_IDS.NP_PROP_DESCRIPTION_UPDATE, 'zh'),
      getPromptTemplate(PROMPT_IDS.NP_PROP_DESCRIPTION_UPDATE, 'en'),
    ]

    for (const template of templates) {
      expect(template).toContain('item_type')
      expect(template).toContain('coverage_scenes')
      expect(template).toContain('coverage_episodes')
      expect(template).toContain('variants')
      expect(template).toContain('item_id')
      expect(template).toContain('design_image')
      expect(template).toContain('significance')
      expect(template).toContain('"prompt"')
    }
  })

  it('renders manual asset prompts without unresolved placeholders', () => {
    const renderedPrompts = [
      renderCharacterCreate('zh'),
      renderCharacterCreate('en'),
      renderCharacterModify('zh'),
      renderCharacterModify('en'),
      renderCharacterDescriptionUpdate('zh'),
      renderCharacterDescriptionUpdate('en'),
      renderCharacterRegenerate('zh'),
      renderCharacterRegenerate('en'),
      renderLocationCreate('zh'),
      renderLocationCreate('en'),
      renderLocationModify('zh'),
      renderLocationModify('en'),
      renderLocationDescriptionUpdate('zh'),
      renderLocationDescriptionUpdate('en'),
      renderLocationRegenerate('zh'),
      renderLocationRegenerate('en'),
      renderPropDescriptionUpdate('zh'),
      renderPropDescriptionUpdate('en'),
    ]

    for (const rendered of renderedPrompts) {
      expect(rendered).not.toContain('{user_input}')
      expect(rendered).not.toContain('{character_input}')
      expect(rendered).not.toContain('{location_name}')
      expect(rendered).not.toContain('{location_input}')
      expect(rendered).not.toContain('{original_description}')
      expect(rendered).not.toContain('{modify_instruction}')
      expect(rendered).not.toContain('{image_context}')
      expect(rendered).not.toContain('{prop_name}')
      expect(rendered).not.toContain('{character_name}')
      expect(rendered).not.toContain('{current_descriptions}')
      expect(rendered).not.toContain('{change_reason}')
      expect(rendered).not.toContain('{novel_text}')
    }
  })
})
