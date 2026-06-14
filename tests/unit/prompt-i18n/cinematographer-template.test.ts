import { describe, expect, it } from 'vitest'
import { buildPrompt, getPromptTemplate, PROMPT_IDS } from '@/lib/prompt-i18n'

const SAMPLE_PANELS_JSON = JSON.stringify([
  {
    panel_id: 'panel-1',
    panel_number: 1,
    description: 'Ari lifts the brass key at the workshop door.',
    source_text: 'Ari lifts the key and says they can finish before sunset.',
    source_anchor: { start: 'Ari lifts', end: 'before sunset.' },
    referenced_assets: { characters: ['Ari'], location: 'workshop_day', props: ['brass_key'] },
    image_prompt: 'Ari at the workshop door with the brass key.',
    visual_prompt: 'Ari at the workshop door with the brass key.',
    video_prompt: 'Close shot, Ari speaks while lifting the brass key.',
    continuity_notes: 'Ari keeps the brass key in the right hand near the doorway.',
    voice_refs: [{ speaker: 'Ari', source_text: 'We can finish this before sunset.' }],
    visual_style: 'cinematic workshop realism',
    visual_style_description: 'Natural workshop light and grounded composition.',
    shot_type: 'close-up',
    camera_move: 'static',
    characters: [{ name: 'Ari', appearance: 'default', slot: 'the open space beside the rear doorway' }],
  },
])

function render(locale: 'zh' | 'en') {
  return buildPrompt({
    promptId: PROMPT_IDS.NP_AGENT_CINEMATOGRAPHER,
    locale,
    variables: {
      panels_json: SAMPLE_PANELS_JSON,
      panel_count: '1',
      locations_description: 'workshop_day: rear doorway, center workbench, high shelf.',
      characters_info: 'Ari: default workshop courier.',
      props_description: 'brass_key: small worn key.',
    },
  })
}

describe('cinematographer prompt template', () => {
  it('registers zh and en templates with FrameOS photography and editor fields', () => {
    const zh = getPromptTemplate(PROMPT_IDS.NP_AGENT_CINEMATOGRAPHER, 'zh')
    const en = getPromptTemplate(PROMPT_IDS.NP_AGENT_CINEMATOGRAPHER, 'en')

    for (const template of [zh, en]) {
      expect(template).toContain('panel_number')
      expect(template).toContain('scene_summary')
      expect(template).toContain('composition')
      expect(template).toContain('lighting')
      expect(template).toContain('color_palette')
      expect(template).toContain('atmosphere')
      expect(template).toContain('technical_notes')
      expect(template).toContain('characters')
      expect(template).toContain('screen_position')
      expect(template).toContain('posture')
      expect(template).toContain('facing')
      expect(template).toContain('depth_of_field')
      expect(template).toContain('color_tone')
      expect(template).toContain('referenced_assets')
      expect(template).toContain('image_prompt')
      expect(template).toContain('visual_prompt')
      expect(template).toContain('video_prompt')
      expect(template).toContain('source_text')
      expect(template).toContain('source_anchor')
      expect(template).toContain('continuity_notes')
      expect(template).toContain('voice_refs')
      expect(template).toContain('visual_style')
      expect(template).toContain('visual_style_description')
    }
  })

  it('renders panel and asset context without unresolved placeholders', () => {
    for (const rendered of [render('zh'), render('en')]) {
      expect(rendered).toContain('"panel_id":"panel-1"')
      expect(rendered).toContain('"referenced_assets":{"characters":["Ari"],"location":"workshop_day","props":["brass_key"]}')
      expect(rendered).toContain('workshop_day: rear doorway')
      expect(rendered).toContain('Ari: default workshop courier.')
      expect(rendered).toContain('brass_key: small worn key.')
      expect(rendered).not.toContain('{panels_json}')
      expect(rendered).not.toContain('{panel_count}')
      expect(rendered).not.toContain('{locations_description}')
      expect(rendered).not.toContain('{characters_info}')
      expect(rendered).not.toContain('{props_description}')
    }
  })
})
