import { describe, expect, it } from 'vitest'
import {
  buildStoryboardJson as buildScriptStoryboardJson,
  buildStoryboardJsonFromClipPanels,
  parseVoiceLinesJson as parseStoryboardVoiceLinesJson,
} from '@/lib/workers/handlers/script-to-storyboard-helpers'
import {
  buildStoryboardJson as buildStandaloneVoiceStoryboardJson,
  parseVoiceLinesJson as parseStandaloneVoiceLinesJson,
} from '@/lib/workers/handlers/voice-analyze-helpers'

describe('voice line parse helpers', () => {
  it('script-to-storyboard parser accepts explicit empty array', () => {
    expect(parseStoryboardVoiceLinesJson('[]')).toEqual([])
  })

  it('script-to-storyboard parser rejects non-object array payload', () => {
    expect(() => parseStoryboardVoiceLinesJson('[1,2]')).toThrow('voice_analyze: invalid payload')
  })

  it('voice-analyze parser accepts explicit empty array', () => {
    expect(parseStandaloneVoiceLinesJson('[]')).toEqual([])
  })

  it('voice-analyze parser rejects non-object array payload', () => {
    expect(() => parseStandaloneVoiceLinesJson('[1,2]')).toThrow('Invalid voice lines data structure')
  })

  it('voice-analyze storyboard context carries FrameOS panel evidence fields', () => {
    const json = buildStandaloneVoiceStoryboardJson([
      {
        id: 'storyboard-1',
        panels: [
          {
            id: 'panel-1',
            panelIndex: 0,
            panelNumber: 1,
            shotType: 'close-up',
            cameraMove: 'static',
            srtSegment: 'Ari says they can finish before sunset.',
            description: 'Ari lifts the brass key at the workshop door.',
            characters: JSON.stringify([{ name: 'Ari' }, { name: 'Mina' }]),
            location: 'workshop_day',
            props: JSON.stringify(['brass_key']),
            duration: 4,
            imagePrompt: 'Ari at the workshop door with the brass key.',
            videoPrompt: 'Close shot, Ari speaks while lifting the brass key.',
            photographyRules: 'Keep Ari near the doorway.',
            actingNotes: JSON.stringify([{ name: 'Ari', acting: 'speaking face remains clear' }]),
            sceneType: 'dialogue',
          },
        ],
      },
    ])

    const rows = JSON.parse(json)
    expect(rows).toEqual([
      expect.objectContaining({
        storyboardId: 'storyboard-1',
        panelIndex: 0,
        panel_id: 'panel-1',
        panel_number: 1,
        text_segment: 'Ari says they can finish before sunset.',
        source_text: 'Ari says they can finish before sunset.',
        source_anchor: { text: 'Ari says they can finish before sunset.' },
        characters: ['Ari', 'Mina'],
        location: 'workshop_day',
        props: ['brass_key'],
        referenced_assets: {
          characters: ['Ari', 'Mina'],
          location: 'workshop_day',
          props: ['brass_key'],
        },
        scene_type: 'dialogue',
        shot_type: 'close-up',
        camera_move: 'static',
        image_prompt: 'Ari at the workshop door with the brass key.',
        video_prompt: 'Close shot, Ari speaks while lifting the brass key.',
        voice_refs: [],
        duration: 4,
      }),
    ])
    expect(rows[0].continuity_notes).toContain('Keep Ari near the doorway.')
    expect(rows[0].continuity_notes).toContain('speaking face remains clear')
  })

  it('script-to-storyboard persisted context carries FrameOS panel evidence fields', () => {
    const json = buildScriptStoryboardJson([
      {
        storyboardId: 'storyboard-1',
        clipId: 'clip-1',
        panels: [
          {
            id: 'panel-1',
            panelIndex: 0,
            panelNumber: 1,
            shotType: 'close-up',
            cameraMove: 'static',
            description: 'Ari lifts the brass key at the workshop door.',
            location: 'workshop_day',
            srtSegment: 'Ari says they can finish before sunset.',
            characters: JSON.stringify([{ name: 'Ari' }, { name: 'Mina' }]),
            props: JSON.stringify(['brass_key']),
            duration: 4,
            imagePrompt: 'Ari at the workshop door with the brass key.',
            videoPrompt: 'Close shot, Ari speaks while lifting the brass key.',
            photographyRules: 'Keep Ari near the doorway.',
            actingNotes: JSON.stringify([{ name: 'Ari', acting: 'speaking face remains clear' }]),
            sceneType: 'dialogue',
          },
        ],
      },
    ])

    const rows = JSON.parse(json)
    expect(rows[0]).toEqual(expect.objectContaining({
      storyboardId: 'storyboard-1',
      panelIndex: 0,
      panel_id: 'panel-1',
      panel_number: 1,
      source_text: 'Ari says they can finish before sunset.',
      source_anchor: { text: 'Ari says they can finish before sunset.' },
      referenced_assets: {
        characters: ['Ari', 'Mina'],
        location: 'workshop_day',
        props: ['brass_key'],
      },
      scene_type: 'dialogue',
      shot_type: 'close-up',
      camera_move: 'static',
      image_prompt: 'Ari at the workshop door with the brass key.',
      video_prompt: 'Close shot, Ari speaks while lifting the brass key.',
      voice_refs: [],
      duration: 4,
    }))
    expect(rows[0].continuity_notes).toContain('Keep Ari near the doorway.')
    expect(rows[0].continuity_notes).toContain('speaking face remains clear')
  })

  it('persisted storyboard context restores FrameOS metadata from actingNotes', () => {
    const actingNotes = JSON.stringify({
      _frameosPanelMetadata: {
        panel_id: 'frameos-panel-1',
        panel_number: 7,
        source_text: 'Ari raises the brass key and speaks.',
        source_anchor: { start: 'Ari raises', end: 'speaks.' },
        referenced_assets: { characters: ['Ari'], location: 'workshop_day', props: ['brass_key'] },
        visual_prompt: 'Ari at the workshop door with the brass key.',
        visual_style: 'grounded workshop realism',
        visual_style_description: 'Natural light and stable composition.',
        continuity_notes: 'Ari keeps the brass key in the right hand.',
        voice_refs: [{ speaker: 'Ari', source_text: 'We can finish this before sunset.' }],
      },
      characters: [{ name: 'Ari', acting: 'speaking face remains clear' }],
    })

    const scriptRows = JSON.parse(buildScriptStoryboardJson([
      {
        storyboardId: 'storyboard-1',
        clipId: 'clip-1',
        panels: [{
          id: 'panel-1',
          panelIndex: 0,
          panelNumber: 1,
          shotType: 'close-up',
          cameraMove: 'static',
          description: 'Ari lifts the brass key at the workshop door.',
          location: 'workshop_day',
          srtSegment: 'legacy segment',
          characters: JSON.stringify([{ name: 'Ari' }]),
          props: JSON.stringify(['brass_key']),
          duration: 4,
          imagePrompt: 'legacy image prompt',
          videoPrompt: 'Close shot, Ari speaks while lifting the brass key.',
          photographyRules: 'Keep Ari near the doorway.',
          actingNotes,
          sceneType: 'dialogue',
        }],
      },
    ]))
    const voiceRows = JSON.parse(buildStandaloneVoiceStoryboardJson([
      {
        id: 'storyboard-1',
        panels: [{
          id: 'panel-1',
          panelIndex: 0,
          panelNumber: 1,
          shotType: 'close-up',
          cameraMove: 'static',
          description: 'Ari lifts the brass key at the workshop door.',
          characters: JSON.stringify([{ name: 'Ari' }]),
          location: 'workshop_day',
          props: JSON.stringify(['brass_key']),
          srtSegment: 'legacy segment',
          duration: 4,
          imagePrompt: 'legacy image prompt',
          videoPrompt: 'Close shot, Ari speaks while lifting the brass key.',
          photographyRules: 'Keep Ari near the doorway.',
          actingNotes,
          sceneType: 'dialogue',
        }],
      },
    ]))

    for (const row of [scriptRows[0], voiceRows[0]]) {
      expect(row).toEqual(expect.objectContaining({
        panel_id: 'frameos-panel-1',
        panel_number: 7,
        source_text: 'Ari raises the brass key and speaks.',
        source_anchor: { start: 'Ari raises', end: 'speaks.' },
        referenced_assets: { characters: ['Ari'], location: 'workshop_day', props: ['brass_key'] },
        visual_prompt: 'Ari at the workshop door with the brass key.',
        voice_refs: [{ speaker: 'Ari', source_text: 'We can finish this before sunset.' }],
      }))
      expect(row.continuity_notes).toContain('Ari keeps the brass key in the right hand.')
      expect(row.continuity_notes).toContain('Ari: speaking face remains clear')
    }
  })

  it('script-to-storyboard clip panel context preserves generated FrameOS fields', () => {
    const json = buildStoryboardJsonFromClipPanels([
      {
        clipId: 'clip-1',
        clipIndex: 0,
        finalPanels: [
          {
            panel_id: 'panel-1',
            panel_number: 1,
            source_text: 'Ari raises the brass key and speaks.',
            source_anchor: { start: 'Ari raises', end: 'speaks.' },
            referenced_assets: { characters: ['Ari'], location: 'workshop_day', props: ['brass_key'] },
            description: 'Ari lifts the brass key at the workshop door.',
            characters: ['Ari'],
            location: 'workshop_day',
            props: ['brass_key'],
            scene_type: 'dialogue',
            shot_type: 'close-up',
            camera_move: 'static',
            image_prompt: 'Ari at the workshop door with the brass key.',
            visual_prompt: 'Ari at the workshop door with the brass key.',
            video_prompt: 'Close shot, Ari speaks while lifting the brass key.',
            continuity_notes: 'Ari keeps the brass key in the right hand.',
            voice_refs: [{ speaker: 'Ari', source_text: 'We can finish this before sunset.' }],
            duration: 4,
          },
        ],
      },
    ])

    const rows = JSON.parse(json)
    expect(rows[0]).toEqual(expect.objectContaining({
      storyboardId: 'clip-1',
      panelIndex: 0,
      panel_id: 'panel-1',
      panel_number: 1,
      source_text: 'Ari raises the brass key and speaks.',
      source_anchor: { start: 'Ari raises', end: 'speaks.' },
      referenced_assets: { characters: ['Ari'], location: 'workshop_day', props: ['brass_key'] },
      characters: ['Ari'],
      location: 'workshop_day',
      props: ['brass_key'],
      scene_type: 'dialogue',
      shot_type: 'close-up',
      camera_move: 'static',
      image_prompt: 'Ari at the workshop door with the brass key.',
      visual_prompt: 'Ari at the workshop door with the brass key.',
      video_prompt: 'Close shot, Ari speaks while lifting the brass key.',
      continuity_notes: 'Ari keeps the brass key in the right hand.',
      voice_refs: [{ speaker: 'Ari', source_text: 'We can finish this before sunset.' }],
      duration: 4,
    }))
  })
})
