import { describe, expect, it } from 'vitest'
import {
  extraPlaybackSpeedCount,
  normalizePlaybackDraft,
  sanitizePlayback,
  togglePlaybackSpeed,
} from '@/features/interactive/gameplay-edit'
import { parseStoryConfigInput } from '@/lib/interactive/config'
import type { StoryPlaybackConfig } from '@/lib/interactive/types'

const speeds = (playback: StoryPlaybackConfig) => playback.speeds
const garbage = (playback: unknown) => playback as StoryPlaybackConfig

describe('gameplay edit playback draft', () => {
  it('always offers 1x and keeps the canonical order', () => {
    expect(normalizePlaybackDraft(undefined)).toEqual({ speeds: [1] })
    expect(speeds(normalizePlaybackDraft({ speeds: [] }))).toEqual([1])
    expect(speeds(normalizePlaybackDraft({ speeds: [1.5] }))).toEqual([1, 1.5])
    expect(speeds(normalizePlaybackDraft({ speeds: [1.5, 1.25] }))).toEqual([1, 1.25, 1.5])
    expect(speeds(normalizePlaybackDraft({ speeds: [1.25, 1, 1.25] }))).toEqual([1, 1.25])
  })

  it('is tolerant of garbage and never aliases the stored array', () => {
    expect(speeds(normalizePlaybackDraft(garbage({ speeds: [2, 0.5, '1.5', null] })))).toEqual([1])
    expect(speeds(normalizePlaybackDraft(garbage({ speeds: 'fast' })))).toEqual([1])
    expect(speeds(normalizePlaybackDraft(garbage({ speeds: { 1: true } })))).toEqual([1])
    expect(speeds(normalizePlaybackDraft(garbage('on')))).toEqual([1])
    expect(speeds(normalizePlaybackDraft(garbage(null)))).toEqual([1])
    const stored: StoryPlaybackConfig = { speeds: [1, 1.25] }
    const draft = normalizePlaybackDraft(stored)
    expect(draft).not.toBe(stored)
    expect(draft.speeds).not.toBe(stored.speeds)
    stored.speeds.push(1.5)
    expect(draft.speeds).toEqual([1, 1.25])
  })

  it('saves exactly the sanitized draft', () => {
    expect(sanitizePlayback({ speeds: [1.5, 1.25] })).toEqual({ speeds: [1, 1.25, 1.5] })
    expect(sanitizePlayback(undefined)).toEqual({ speeds: [1] })
    expect(sanitizePlayback(garbage({ speeds: [9] }))).toEqual({ speeds: [1] })
  })
})

describe('toggling playback speeds', () => {
  it('adds and removes the extra speeds while keeping the order', () => {
    expect(togglePlaybackSpeed({ speeds: [1] }, 1.25)).toEqual({ speeds: [1, 1.25] })
    expect(togglePlaybackSpeed({ speeds: [1, 1.25] }, 1.5)).toEqual({ speeds: [1, 1.25, 1.5] })
    expect(togglePlaybackSpeed({ speeds: [1, 1.25, 1.5] }, 1.25)).toEqual({ speeds: [1, 1.5] })
    expect(togglePlaybackSpeed({ speeds: [1, 1.25] }, 1.25)).toEqual({ speeds: [1] })
  })

  it('never lets 1x be removed', () => {
    expect(togglePlaybackSpeed({ speeds: [1] }, 1)).toEqual({ speeds: [1] })
    expect(togglePlaybackSpeed({ speeds: [1, 1.25, 1.5] }, 1)).toEqual({ speeds: [1, 1.25, 1.5] })
    expect(togglePlaybackSpeed(garbage({ speeds: [1.5] }), 1)).toEqual({ speeds: [1, 1.5] })
  })

  it('starts from a normalized draft when the stored value is odd', () => {
    expect(togglePlaybackSpeed(garbage({ speeds: [2, 1.5] }), 1.25)).toEqual({ speeds: [1, 1.25, 1.5] })
  })
})

describe('playback badge count', () => {
  it('counts only the extra speeds', () => {
    expect(extraPlaybackSpeedCount(undefined)).toBe(0)
    expect(extraPlaybackSpeedCount({ speeds: [1] })).toBe(0)
    expect(extraPlaybackSpeedCount({ speeds: [1, 1.25] })).toBe(1)
    expect(extraPlaybackSpeedCount({ speeds: [1.5, 1, 1.25] })).toBe(2)
    expect(extraPlaybackSpeedCount(garbage({ speeds: [3] }))).toBe(0)
  })
})

describe('playback patches survive the server rules unchanged', () => {
  const base = { version: 1 as const, variables: [], chapters: [], links: [], start: null }

  it('round-trips every sanitized combination', () => {
    for (const playback of [normalizePlaybackDraft(undefined), sanitizePlayback({ speeds: [1.5] }), sanitizePlayback({ speeds: [1.25, 1.5] })]) {
      const result = parseStoryConfigInput({ ...base, playback })
      expect(result.ok).toBe(true)
      if (!result.ok) continue
      expect(result.config.playback).toEqual(playback)
    }
  })

  it('leaves a work saved before this setting existed without a playback key', () => {
    const result = parseStoryConfigInput(base)
    expect(result.ok).toBe(true)
    expect(result.ok && 'playback' in result.config).toBe(false)
  })
})
