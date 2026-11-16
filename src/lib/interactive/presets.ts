import type { StoryInteractionKind } from './types'

export type StoryDifficulty = 'easy' | 'normal' | 'hard'
export const STORY_DIFFICULTIES: readonly StoryDifficulty[] = ['easy', 'normal', 'hard']
export const STORY_DIFFICULTY_LABEL: Record<StoryDifficulty, string> = { easy: '简单', normal: '普通', hard: '困难' }

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const tenths = (value: number) => Math.round(value * 10) / 10

const PRESETS: Record<StoryInteractionKind, Record<StoryDifficulty, Record<string, number | boolean>>> = {
  tap: {
    easy: { durationSec: 5, count: 5 },
    normal: { durationSec: 3, count: 10 },
    hard: { durationSec: 2.5, count: 18 },
  },
  swipe: {
    easy: { durationSec: 1.5 },
    normal: { durationSec: 1 },
    hard: { durationSec: 1 },
  },
  timing: {
    easy: { durationSec: 4, speed: 1, perfectWidth: 20, normalWidth: 50 },
    normal: { durationSec: 3, speed: 1.5, perfectWidth: 12, normalWidth: 30 },
    hard: { durationSec: 3, speed: 2.5, perfectWidth: 8, normalWidth: 18 },
  },
  hold: {
    easy: { durationSec: 5, fillSec: 1.5, rangeMin: 70, rangeMax: 100, overchargeFails: false },
    normal: { durationSec: 4, fillSec: 2, rangeMin: 80, rangeMax: 100, overchargeFails: false },
    hard: { durationSec: 4, fillSec: 2.5, rangeMin: 85, rangeMax: 100, overchargeFails: true },
  },
  hotspot: {
    easy: { durationSec: 10, showZones: true },
    normal: { durationSec: 6, showZones: false },
    hard: { durationSec: 4, showZones: false },
  },
  choice: {
    easy: { durationSec: 6 },
    normal: { durationSec: 3 },
    hard: { durationSec: 2 },
  },
}

/** 只产出编辑器字段，绝不产生新的 spec 语义；调用方一次 patch 完成一次 undo。 */
export function difficultyPreset(kind: StoryInteractionKind, difficulty: StoryDifficulty): Record<string, number | boolean> {
  const raw = PRESETS[kind][difficulty]
  const preset: Record<string, number | boolean> = { durationSec: tenths(clamp(Number(raw.durationSec), 0.5, 120)) }
  switch (kind) {
    case 'tap':
      preset.count = Math.round(clamp(Number(raw.count), 1, 99))
      break
    case 'timing': {
      const perfectWidth = Math.round(clamp(Number(raw.perfectWidth), 2, 50))
      preset.speed = clamp(Number(raw.speed), 0.25, 4)
      preset.perfectWidth = perfectWidth
      preset.normalWidth = Math.max(perfectWidth, Math.round(clamp(Number(raw.normalWidth), 4, 90)))
      break
    }
    case 'hold': {
      const rangeMin = Math.round(clamp(Number(raw.rangeMin), 0, 100))
      preset.fillSec = tenths(clamp(Number(raw.fillSec), 0.5, 20))
      preset.rangeMin = rangeMin
      preset.rangeMax = Math.max(rangeMin, Math.round(clamp(Number(raw.rangeMax), 0, 100)))
      preset.overchargeFails = raw.overchargeFails === true
      break
    }
    case 'hotspot':
      preset.showZones = raw.showZones === true
      break
    case 'swipe':
    case 'choice':
      break
  }
  return preset
}

/** 难度不进 data：当前值与某档预设完全一致时才算选中，改过任一参数就三档都不选。 */
export function matchesDifficultyPreset(kind: StoryInteractionKind, difficulty: StoryDifficulty, current: Record<string, unknown>): boolean {
  return Object.entries(difficultyPreset(kind, difficulty)).every(([key, value]) => current[key] === value)
}
