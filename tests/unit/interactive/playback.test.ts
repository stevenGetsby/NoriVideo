import { describe, expect, it } from 'vitest'
import { buildStoryProgram, withConfig, type StoryOverviewData } from '@/features/interactive/story-overview-model'
import { normalizeStoryConfig, parseStoryConfigInput } from '@/lib/interactive/config'
import { STORY_SLOW_RATE } from '@/lib/interactive/interaction'
import { beatPlaybackRate, nextSpeed, normalizeSpeed, playbackSpeeds, speedLabel } from '@/lib/interactive/playback'

describe('which speeds a viewer is offered', () => {
  it('only offers 1x to a work with no playback settings', () => {
    expect(playbackSpeeds(undefined)).toEqual([1])
    expect(playbackSpeeds({ speeds: [] })).toEqual([1])
  })

  it('always keeps 1x and lists the picked speeds slowest first', () => {
    expect(playbackSpeeds({ speeds: [1.5] })).toEqual([1, 1.5])
    expect(playbackSpeeds({ speeds: [1.5, 1.25] })).toEqual([1, 1.25, 1.5])
    expect(playbackSpeeds({ speeds: [1.25, 1.25, 1] })).toEqual([1, 1.25])
  })

  it('drops speeds the player does not know', () => {
    const stored = { speeds: [2, 0.5, 0, -1, 1.3, '1.5', null] as unknown as number[] }
    expect(playbackSpeeds(stored as never)).toEqual([1])
  })

  it('labels the HUD button', () => {
    expect([1, 1.25, 1.5].map(speedLabel)).toEqual(['1x', '1.25x', '1.5x'])
  })
})

describe('switching speed', () => {
  it('cycles through the offered speeds and wraps back to 1x', () => {
    const speeds = [1, 1.25, 1.5]
    expect(nextSpeed(speeds, 1)).toBe(1.25)
    expect(nextSpeed(speeds, 1.25)).toBe(1.5)
    expect(nextSpeed(speeds, 1.5)).toBe(1)
    expect(nextSpeed([1, 1.5], 1.5)).toBe(1)
  })

  it('restarts from 1x when the current speed is not on offer any more', () => {
    expect(nextSpeed([1, 1.5], 1.25)).toBe(1)
    expect(nextSpeed([1], 1)).toBe(1)
  })

  it('falls back to 1x for a remembered speed that is no longer offered', () => {
    expect(normalizeSpeed(1.25, [1, 1.25])).toBe(1.25)
    expect(normalizeSpeed(1.5, [1, 1.25])).toBe(1)
    expect(normalizeSpeed(7, [1])).toBe(1)
  })
})

describe('the picture while an interaction is on screen', () => {
  it('plays at real pace, slows to the fixed slow-motion rate, or stops', () => {
    expect(beatPlaybackRate('play')).toBe(1)
    expect(beatPlaybackRate('slow')).toBe(STORY_SLOW_RATE)
    expect(beatPlaybackRate('freeze')).toBe(0)
  })
})

describe('playback in the stored config', () => {
  it('reads the picked speeds and always adds 1x', () => {
    expect(normalizeStoryConfig({ playback: { speeds: [1.25] } }).playback).toEqual({ speeds: [1, 1.25] })
    expect(normalizeStoryConfig({ playback: { speeds: [1.5, 1.25, 3] } }).playback).toEqual({ speeds: [1, 1.25, 1.5] })
    expect(normalizeStoryConfig({ playback: {} }).playback).toEqual({ speeds: [1] })
    expect(normalizeStoryConfig({ playback: { speeds: 'fast' } }).playback).toEqual({ speeds: [1] })
  })

  it('ignores a playback block that is not an object', () => {
    for (const raw of ['x', 1.5, true, [], null, undefined]) expect('playback' in normalizeStoryConfig({ playback: raw })).toBe(false)
  })

  it('leaves configs saved before this setting existed without one', () => {
    const old = normalizeStoryConfig({ version: 1, variables: [], chapters: [], links: [], start: null })
    expect('playback' in old).toBe(false)
  })

  it('rejects a submitted playback block of the wrong shape', () => {
    const message = (playback: unknown) => {
      const result = parseStoryConfigInput({ version: 1, variables: [], chapters: [], links: [], start: null, playback })
      return result.ok ? null : result.message
    }
    expect(message('on')).toBe('倍速配置格式错误。')
    expect(message([])).toBe('倍速配置格式错误。')
    expect(message({ speeds: 'fast' })).toBe('倍速配置格式错误。')
    expect(message({ speeds: { a: 1 } })).toBe('倍速配置格式错误。')
    expect(message({ speeds: [1.25, 1.5] })).toBeNull()
    expect(message({})).toBeNull()
    expect(message(null)).toBeNull()
  })

  it('round-trips through the strict check with 1x added', () => {
    const result = parseStoryConfigInput({ version: 1, variables: [], chapters: [], links: [], start: null, playback: { speeds: [1.5] } })
    expect(result.ok && result.config.playback).toEqual({ speeds: [1, 1.5] })
  })
})

describe('the trial program', () => {
  const data: StoryOverviewData = {
    story: {
      workId: 'w1',
      name: '雨夜来电',
      aspectRatio: '9:16',
      resolution: '1080p',
      canManage: true,
      canCreateChapters: true,
      config: { version: 1, variables: [], chapters: [], links: [], start: null },
    },
    chapters: [],
  }

  it('hands the speeds to the player only when the creator set them', () => {
    expect('playback' in buildStoryProgram(data)).toBe(false)
    const playback = { speeds: [1 as const, 1.5 as const] }
    expect(buildStoryProgram(withConfig(data, { playback })).playback).toEqual(playback)
  })
})
