import { describe, expect, it } from 'vitest'
import { enrichPanelsForFrameOSPhaseContext } from '@/lib/storyboard-phases'

describe('storyboard phases FrameOS context enrichment', () => {
  it('fills missing FrameOS panel fields before cinematography and acting prompts', () => {
    const rows = enrichPanelsForFrameOSPhaseContext(
      {
        id: 'clip-1',
        content: 'Ari raises the brass key while Mina waits by the workshop door.',
        startText: 'Ari raises the brass key',
        endText: 'Mina waits by the workshop door.',
        characters: JSON.stringify([{ name: 'Ari' }, { name: 'Mina' }]),
        location: 'workshop_day',
        props: JSON.stringify(['brass_key']),
      },
      [{
        panel_number: 2,
        description: 'Ari turns toward Mina with the key.',
        image_prompt: 'Ari and Mina at the workshop door.',
        shot_type: 'medium',
        camera_move: 'static',
      }],
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual(expect.objectContaining({
      panel_id: 'panel_2',
      panel_number: 2,
      source_text: 'Ari turns toward Mina with the key.',
      source_anchor: {
        start: 'Ari raises the brass key',
        end: 'Mina waits by the workshop door.',
      },
      location: 'workshop_day',
      props: ['brass_key'],
      visual_prompt: 'Ari and Mina at the workshop door.',
      continuity_notes: '',
      voice_refs: [],
    }))
    expect(rows[0].characters).toEqual(['Ari', 'Mina'])
    expect(rows[0].referenced_assets).toEqual({
      characters: ['Ari', 'Mina'],
      location: 'workshop_day',
      props: ['brass_key'],
    })
  })

  it('preserves model-provided FrameOS fields', () => {
    const rows = enrichPanelsForFrameOSPhaseContext(
      {
        id: 'clip-1',
        content: 'fallback clip text',
        characters: JSON.stringify([{ name: 'Ari' }]),
        location: 'workshop_day',
        props: JSON.stringify(['brass_key']),
      },
      [{
        panel_id: 'model-panel-1',
        panel_number: 1,
        source_text: 'Ari says they can finish before sunset.',
        source_anchor: { start: 'Ari says', end: 'before sunset.' },
        characters: [{ name: 'Ari', appearance: 'default' }],
        location: 'workshop_night',
        props: ['silver_key'],
        referenced_assets: {
          characters: [{ name: 'Ari', appearance: 'default' }],
          location: 'workshop_night',
          props: ['silver_key'],
        },
        visual_prompt: 'Ari under night workshop light.',
        continuity_notes: 'Keep Ari near the rear doorway.',
        voice_refs: [{ speaker: 'Ari', source_text: 'We can finish this before sunset.' }],
      }],
    )

    expect(rows[0]).toEqual(expect.objectContaining({
      panel_id: 'model-panel-1',
      source_text: 'Ari says they can finish before sunset.',
      source_anchor: { start: 'Ari says', end: 'before sunset.' },
      location: 'workshop_night',
      visual_prompt: 'Ari under night workshop light.',
      continuity_notes: 'Keep Ari near the rear doorway.',
      voice_refs: [{ speaker: 'Ari', source_text: 'We can finish this before sunset.' }],
    }))
    expect(rows[0].characters).toEqual([{ name: 'Ari', appearance: 'default' }])
    expect(rows[0].referenced_assets).toEqual({
      characters: [{ name: 'Ari', appearance: 'default' }],
      location: 'workshop_night',
      props: ['silver_key'],
    })
  })
})
