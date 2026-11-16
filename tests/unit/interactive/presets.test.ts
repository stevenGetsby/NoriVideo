import { describe, expect, it } from 'vitest'
import { defaultInteractionData, readInteractionData } from '@/lib/interactive/interaction'
import { difficultyPreset, matchesDifficultyPreset, STORY_DIFFICULTIES } from '@/lib/interactive/presets'
import { STORY_INTERACTION_KINDS, type StoryInteractionKind } from '@/lib/interactive/types'

let seq = 0
const createId = () => `preset_${++seq}`

const SPEC_FIELDS: Record<StoryInteractionKind, string[]> = {
  tap: ['count'],
  swipe: [],
  timing: ['speed', 'perfectWidth', 'normalWidth'],
  hold: ['fillSec', 'rangeMin', 'rangeMax', 'overchargeFails'],
  hotspot: ['showZones'],
  choice: [],
}

describe('difficulty presets', () => {
  it('keeps all 18 presets inside the reader bounds and only touches spec fields', () => {
    for (const kind of STORY_INTERACTION_KINDS) {
      for (const difficulty of STORY_DIFFICULTIES) {
        const preset = difficultyPreset(kind, difficulty)
        expect(Object.keys(preset).sort()).toEqual(['durationSec', ...SPEC_FIELDS[kind]].sort())
        const data = readInteractionData({ ...defaultInteractionData(kind, createId), ...preset })
        expect(data.durationSec).toBe(preset.durationSec)
        expect(data.durationSec).toBeGreaterThanOrEqual(0.5)
        expect(data.durationSec).toBeLessThanOrEqual(120)
        for (const [key, value] of Object.entries(preset)) {
          if (key === 'durationSec') continue
          expect((data.spec as unknown as Record<string, unknown>)[key]).toBe(value)
        }
      }
    }
  })

  it('selects the matching difficulty and deselects every tier after a manual tweak', () => {
    for (const kind of STORY_INTERACTION_KINDS) {
      for (const difficulty of STORY_DIFFICULTIES) {
        const preset = difficultyPreset(kind, difficulty)
        const data = readInteractionData({ ...defaultInteractionData(kind, createId), ...preset })
        const current: Record<string, unknown> = { ...data.spec, durationSec: data.durationSec }
        expect(matchesDifficultyPreset(kind, difficulty, current)).toBe(true)
        expect(matchesDifficultyPreset(kind, difficulty, { ...current, durationSec: data.durationSec + 0.5 })).toBe(false)
      }
    }
    const tap = readInteractionData({ ...defaultInteractionData('tap', createId), ...difficultyPreset('tap', 'normal') })
    expect(matchesDifficultyPreset('tap', 'normal', { ...tap.spec, durationSec: tap.durationSec, count: tap.spec.type === 'tap' ? tap.spec.count + 1 : 0 })).toBe(false)
  })

  it('matches the design table', () => {
    expect(difficultyPreset('tap', 'easy')).toEqual({ durationSec: 5, count: 5 })
    expect(difficultyPreset('tap', 'hard')).toEqual({ durationSec: 2.5, count: 18 })
    expect(difficultyPreset('swipe', 'easy')).toEqual({ durationSec: 1.5 })
    expect(difficultyPreset('timing', 'normal')).toEqual({ durationSec: 3, speed: 1.5, perfectWidth: 12, normalWidth: 30 })
    expect(difficultyPreset('hold', 'hard')).toEqual({ durationSec: 4, fillSec: 2.5, rangeMin: 85, rangeMax: 100, overchargeFails: true })
    expect(difficultyPreset('hotspot', 'easy')).toEqual({ durationSec: 10, showZones: true })
    expect(difficultyPreset('choice', 'hard')).toEqual({ durationSec: 2 })
  })
})
