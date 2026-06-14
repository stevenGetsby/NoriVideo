import { describe, expect, it } from 'vitest'
import { buildPrompt, getPromptTemplate, PROMPT_IDS } from '@/lib/prompt-i18n'

const SAMPLE_PANEL = JSON.stringify([
  {
    panel_id: 'EP01-S01-P001',
    panel_number: 1,
    description: 'Ari lifts the brass key near the workshop door.',
    characters: [{ name: 'Ari', appearance: 'default', slot: 'the open space beside the rear doorway' }],
    location: 'workshop_day',
    props: ['brass_key'],
    scene_type: 'daily',
    source_text: 'Ari lifts the brass key and says they can finish before sunset.',
    referenced_assets: { characters: ['Ari'], location: 'workshop_day', props: ['brass_key'] },
    video_prompt: 'A young woman lifts the brass key near the workshop door while speaking, camera slowly pushes in.',
  },
])

describe('storyboard video prompt templates', () => {
  it('requires production grammar in storyboard plan templates', () => {
    const zh = getPromptTemplate(PROMPT_IDS.NP_AGENT_STORYBOARD_PLAN, 'zh')
    const en = getPromptTemplate(PROMPT_IDS.NP_AGENT_STORYBOARD_PLAN, 'en')

    expect(en).toContain('visual subject + visible action + referenced location/prop/character asset + camera movement + start/end state')
    expect(en).toContain('lip-sync preparation')
    expect(zh).toContain('可视主体（visual subject）+ 可见动作 + 被引用的场景/道具/角色资产 + 镜头运动 + 本节拍起止状态（start/end state）')
    expect(zh).toContain('口型/配音准备')
  })

  it('requires production grammar in storyboard detail templates', () => {
    const zh = getPromptTemplate(PROMPT_IDS.NP_AGENT_STORYBOARD_DETAIL, 'zh')
    const en = getPromptTemplate(PROMPT_IDS.NP_AGENT_STORYBOARD_DETAIL, 'en')

    expect(en).toContain('visual subject + visible action + referenced location/prop/character asset + camera movement + start/end state')
    expect(en).toContain('lip-sync preparation')
    expect(zh).toContain('可视主体（visual subject）+ 可见动作 + 被引用的场景/道具/角色资产 + 镜头运动 + 本节拍起止状态（start/end state）')
    expect(zh).toContain('口型/配音准备')
  })

  it('renders storyboard context without unresolved placeholders', () => {
    const rendered = buildPrompt({
      promptId: PROMPT_IDS.NP_AGENT_STORYBOARD_DETAIL,
      locale: 'en',
      variables: {
        panels_json: SAMPLE_PANEL,
        characters_age_gender: 'Ari: young woman',
        locations_description: 'workshop_day: rear doorway and central workbench',
        props_description: 'brass_key: small worn brass key',
      },
    })

    expect(rendered).toContain('"panel_id":"EP01-S01-P001"')
    expect(rendered).toContain('workshop_day: rear doorway')
    expect(rendered).toContain('visual subject + visible action')
    expect(rendered).not.toContain('{panels_json}')
    expect(rendered).not.toContain('{characters_age_gender}')
    expect(rendered).not.toContain('{locations_description}')
    expect(rendered).not.toContain('{props_description}')
  })
})
