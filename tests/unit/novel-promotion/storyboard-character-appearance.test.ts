import { describe, expect, it } from 'vitest'
import {
  selectStoryboardCharacterAppearance,
} from '@/lib/novel-promotion/storyboard-character-appearance'

const appearances = [
  { id: 'main', label: '初始形象', isPrimary: true },
  { id: 'rain', label: '雨夜逃亡', coverageEpisodes: [2, 3] },
  { id: 'banquet', label: '宴会礼服', coverageEpisodes: ['E5、E6'], coverageScenes: ['S04'] },
]

describe('storyboard character appearance selection', () => {
  it('uses an explicit appearance id before episode coverage', () => {
    expect(selectStoryboardCharacterAppearance(appearances, {
      episodeNumber: 2,
      requestedAppearance: 'banquet',
    })?.id).toBe('banquet')
  })

  it('selects by scene then episode without relying on array order', () => {
    expect(selectStoryboardCharacterAppearance(appearances, {
      episodeNumber: 5,
      sceneId: 'S04',
    })?.id).toBe('banquet')
    expect(selectStoryboardCharacterAppearance(appearances, {
      episodeNumber: 6,
      sceneId: 'S01',
    })?.id).toBe('banquet')
  })

  it('falls back to the primary appearance when no variant is scoped', () => {
    expect(selectStoryboardCharacterAppearance(appearances, {
      episodeNumber: 1,
      sceneId: 'S01',
      sourceText: '角色在家中平静交谈。',
    })?.id).toBe('main')
  })

  it('prefers a scoped variant when the broad primary covers the same episode', () => {
    expect(selectStoryboardCharacterAppearance([
      { id: 'main', label: '陆府低位姨太时期', isPrimary: true, coverageEpisodes: [5, 6, 7, 8] },
      { id: 'variant', label: '陆府受辱禁足状态', coverageEpisodes: [5, 6, 7, 8] },
    ], {
      episodeNumber: 6,
    })?.id).toBe('variant')
  })

  it('uses the narrowest scoped variant when variant ranges overlap', () => {
    expect(selectStoryboardCharacterAppearance([
      { id: 'main', label: '初始形象', isPrimary: true, coverageEpisodes: [1, 2, 3, 4, 5] },
      { id: 'stage', label: '阶段形象', coverageEpisodes: [2, 3, 4] },
      { id: 'moment', label: '第3集特殊状态', coverageEpisodes: [3] },
    ], {
      episodeNumber: 3,
    })?.id).toBe('moment')
  })

  it('lets workflow coverage correct a planner default-primary answer', () => {
    expect(selectStoryboardCharacterAppearance([
      { id: 'main', label: '初始形象', isPrimary: true, coverageEpisodes: [1, 2, 3] },
      { id: 'episode-2', label: '第2集受伤状态', coverageEpisodes: [2] },
    ], {
      episodeNumber: 2,
      requestedAppearance: '初始形象',
      preferScopedCoverageOverPrimaryRequest: true,
    })?.id).toBe('episode-2')
  })

  it('does not reuse a per-episode S01 scene scope in another episode', () => {
    expect(selectStoryboardCharacterAppearance([
      { id: 'main', label: '初始形象', isPrimary: true },
      { id: 'episode-2-scene-1', label: '第2集第一场状态', coverageEpisodes: [2], coverageScenes: ['S01'] },
    ], {
      episodeNumber: 3,
      sceneId: 'S01',
    })?.id).toBe('main')
  })

  it('expands textual episode ranges', () => {
    for (const coverage of ['E5-E8', '第5至8集']) {
      expect(selectStoryboardCharacterAppearance([
        { id: 'main', label: '初始形象', isPrimary: true },
        { id: 'range', label: '阶段形象', coverageEpisodes: [coverage] },
      ], {
        episodeNumber: 7,
      })?.id).toBe('range')
    }
  })
})
