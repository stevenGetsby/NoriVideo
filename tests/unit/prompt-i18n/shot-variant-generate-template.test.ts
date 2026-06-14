import { describe, expect, it } from 'vitest'
import { buildPrompt, getPromptTemplate, PROMPT_IDS } from '@/lib/prompt-i18n'

const SAMPLE_PROMPT_SEED = JSON.stringify({
  image_prompt: 'Ari at the workshop door.',
  visual_prompt: 'Ari at the workshop door.',
  video_prompt: 'Ari opens the door while the camera slowly pushes in.',
  source_text: 'Ari opens the workshop door.',
  source_anchor: { start: 'Ari opens', end: 'workshop door.' },
  referenced_assets: { characters: ['Ari'], location: 'workshop_day', props: ['brass_key'] },
  continuity_notes: 'Keep Ari at the same entrance.',
  voice_refs: [{ speaker: 'Ari', source_text: 'We start here.' }],
  visual_style: 'cinematic workshop realism',
  visual_style_description: 'Natural workshop light and grounded composition.',
})

function render(locale: 'zh' | 'en') {
  return buildPrompt({
    promptId: PROMPT_IDS.NP_AGENT_SHOT_VARIANT_GENERATE,
    locale,
    variables: {
      original_description: 'Ari opens the workshop door.',
      original_shot_type: 'medium shot',
      original_camera_move: 'slow push in',
      location: 'workshop_day',
      characters_info: 'Ari, default appearance, entrance slot',
      variant_title: 'low angle',
      variant_description: 'Make the shot stronger without changing story action.',
      target_shot_type: 'low angle medium shot',
      target_camera_move: 'static',
      video_prompt: SAMPLE_PROMPT_SEED,
      character_assets: 'Ari reference image available',
      location_asset: 'workshop_day reference image available',
      aspect_ratio: '9:16',
      style: 'cinematic realism',
    },
  })
}

describe('shot variant generate prompt template', () => {
  it('registers zh and en templates with FrameOS production fields', () => {
    const zh = getPromptTemplate(PROMPT_IDS.NP_AGENT_SHOT_VARIANT_GENERATE, 'zh')
    const en = getPromptTemplate(PROMPT_IDS.NP_AGENT_SHOT_VARIANT_GENERATE, 'en')

    for (const template of [zh, en]) {
      expect(template).toContain('referenced_assets')
      expect(template).toContain('image_prompt')
      expect(template).toContain('visual_prompt')
      expect(template).toContain('video_prompt')
      expect(template).toContain('source_anchor')
      expect(template).toContain('continuity_notes')
      expect(template).toContain('voice_refs')
      expect(template).toContain('visual_style')
      expect(template).toContain('visual_style_description')
    }
  })

  it('renders prompt seed without unresolved placeholders', () => {
    for (const rendered of [render('zh'), render('en')]) {
      expect(rendered).toContain('"visual_prompt":"Ari at the workshop door."')
      expect(rendered).toContain('"referenced_assets":{"characters":["Ari"],"location":"workshop_day","props":["brass_key"]}')
      expect(rendered).toContain('low angle')
      expect(rendered).not.toContain('{video_prompt}')
      expect(rendered).not.toContain('{variant_title}')
      expect(rendered).not.toContain('{style}')
    }
  })
})
