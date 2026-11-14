import * as React from 'react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { PlayerHud } from '@/features/interactive/PlayerHud'
import { AchievementSheet } from '@/features/interactive/player/AchievementSheet'
import { MapSheet } from '@/features/interactive/player/MapSheet'
import { PlayerStage } from '@/features/interactive/PlayerStage'
import { emptyProfile, type StoryProfile } from '@/lib/interactive/achievements'
import { advanceRun, startRun } from '@/lib/interactive/engine'
import { emptySaves, snapshotRun, withCheckpoint } from '@/lib/interactive/saves'
import type { StoryProgram, StoryShop } from '@/lib/interactive/types'
import { achievements, personalityOn, storyProgram } from './p3-fixture'

// The repo compiles TSX with the classic JSX runtime in Vitest; shared components rely on
// React being visible as a global, exactly like the other canvas UI tests.
beforeAll(() => vi.stubGlobal('React', React))
afterAll(() => vi.unstubAllGlobals())

const rewardShop: StoryShop = {
  enabled: true,
  currencyVariableId: 'coin',
  items: [{ id: 'frame', name: '金框', icon: null, description: '', price: 0, limit: 1, effects: [], reward: { title: '', frameUrl: '/gold.png' } }],
}

const earnedProfile: StoryProfile = {
  ...emptyProfile(),
  endings: ['p:goodend'],
  segments: ['p:s1', 'p:s2'],
  achievements: ['a_good'],
  equipped: { title: 'a:a_good', frame: 'a:a_good' },
}

const renderHud = (program: StoryProgram, profile?: StoryProfile) => renderToStaticMarkup(createElement(PlayerHud, {
  program,
  run: startRun(program, { mode: 'story' }),
  orientation: 'portrait',
  ...(profile ? { profile } : {}),
  onOpenShop: () => {},
  onOpenAchievements: () => {},
  onOpenMap: () => {},
} as never))

const mapProgram = storyProgram({ map: { enabled: true } })
const mapRun = startRun(mapProgram, { mode: 'story' })
const checkpoint = snapshotRun(mapRun)!

describe('player HUD record buttons', () => {
  it('adds nothing to an old work', () => {
    const html = renderHud(storyProgram())
    expect(html).not.toContain('hud-achievements')
    expect(html).not.toContain('hud-map')
  })

  it('shows the avatar button for achievements or a reward shop, and the map button only with a map', () => {
    const withAchievements = renderHud(storyProgram({ achievements }))
    expect(withAchievements).toContain('data-testid="hud-achievements"')
    expect(withAchievements).toContain('data-testid="hud-achievement-badge"')
    expect(withAchievements).not.toContain('hud-map')

    const rewardOnly = renderHud(storyProgram({ shop: rewardShop }))
    expect(rewardOnly).toContain('data-testid="hud-achievements"')
    expect(rewardOnly).not.toContain('data-testid="hud-achievement-badge"')
    expect(rewardOnly).not.toContain('hud-map')

    const withMap = renderHud(mapProgram)
    expect(withMap).toContain('data-testid="hud-map"')
    expect(withMap).not.toContain('hud-achievements')
  })

  it('wears the equipped title and frame around the generic avatar', () => {
    const html = renderHud(storyProgram({ achievements }), earnedProfile)
    expect(html).toContain('data-testid="hud-title"')
    expect(html).toContain('最强王者')
    expect(html).toContain('data-frame-url="/gold.png"')
    expect(html).toContain('1/6')
  })
})

describe('achievement sheet', () => {
  it('lists earned and locked achievements with their reward text and the wardrobe', () => {
    const html = renderToStaticMarkup(createElement(AchievementSheet, {
      program: storyProgram({ achievements }),
      profile: earnedProfile,
      orientation: 'portrait',
      onEquip: () => {},
      onClose: () => {},
    } as never))
    expect(html).toContain('data-testid="achievements-sheet"')
    expect(html).toContain('data-testid="achievement-progress">1/6<')
    expect(html.match(/data-testid="achievement-item"/g)).toHaveLength(6)
    expect(html).toContain('data-achievement-id="a_good" data-earned="true"')
    expect(html).toContain('data-achievement-id="a_bad" data-earned="false"')
    expect(html).toContain('称号「最强王者」 + 头像框')
    expect(html).toContain('data-testid="cosmetic-title"')
    expect(html).toContain('data-testid="cosmetic-frame"')
    expect(html).toContain('data-testid="equip-cosmetic"')
    expect(html).toContain('data-testid="unequip-title"')
    expect(html).not.toContain('gradient(')
  })
})

describe('map sheet', () => {
  it('draws unlocked and locked save points, the current one and its checkpoint action', () => {
    const saves = withCheckpoint(emptySaves(), 'p:s1', checkpoint, 10)
    const html = renderToStaticMarkup(createElement(MapSheet, {
      program: mapProgram,
      profile: { ...emptyProfile(), segments: ['p:s1'] },
      run: mapRun,
      saves,
      orientation: 'portrait',
      onResume: () => {},
      onWrite: () => {},
      onLoad: () => {},
      onDelete: () => {},
      onClose: () => {},
    } as never))
    expect(html).toContain('data-testid="map-sheet"')
    expect(html).toContain('data-testid="story-map"')
    expect(html.match(/data-testid="map-point"/g)).toHaveLength(2)
    expect(html).toContain('data-point-key="p:s1" data-unlocked="true"')
    expect(html).toContain('data-point-key="p:s2" data-unlocked="false"')
    expect(html).toContain('data-current="true"')
    expect(html).toContain('data-testid="map-resume" data-point-key="p:s1"')
    expect(html).toContain('data-testid="map-tab-saves"')
    expect(html).not.toContain('gradient(')
  })
})

describe('personality result', () => {
  const personalityProgram = storyProgram({ achievements, personality: personalityOn })
  const choiceRun = advanceRun(personalityProgram, startRun(personalityProgram, { mode: 'story' }))
  const cornerRun = advanceRun(personalityProgram, choiceRun, 'a')
  const endingRun = advanceRun(personalityProgram, cornerRun)
  const unflaggedProgram: StoryProgram = {
    ...personalityProgram,
    chapters: personalityProgram.chapters.map((chapter) => ({
      ...chapter,
      nodes: chapter.nodes.map((node) => (node.kind === 'ending' && node.id === 'goodend' ? { ...node, showPersonality: false } : node)),
    })),
  }
  const unflaggedRun = advanceRun(unflaggedProgram, advanceRun(unflaggedProgram, advanceRun(unflaggedProgram, startRun(unflaggedProgram, { mode: 'story' })), 'a'))

  const renderEnding = (program: StoryProgram, run = endingRun) => renderToStaticMarkup(createElement(PlayerStage, {
    program,
    run,
    backdrop: null,
    orientation: 'portrait',
    attempt: 0,
    onRunChange: () => {},
    onContinue: () => {},
    onChoose: () => {},
    onRestart: () => {},
  } as never))

  it('shows the four-letter result on a flagged ending', () => {
    const html = renderEnding(personalityProgram)
    expect(html).toContain('data-testid="personality-card" data-type="ESTJ"')
    expect(html).toContain('data-testid="personality-type">ESTJ<')
    expect(html).toContain('总经理')
    expect(html).toContain('nori-player-card is-ending is-good has-personality')
  })

  it('shows nothing when the test is off or the ending flag is absent', () => {
    expect(renderEnding(storyProgram({ achievements }))).not.toContain('personality-card')
    expect(renderEnding(storyProgram({ achievements, personality: { enabled: false, results: {} } }))).not.toContain('personality-card')
    expect(renderEnding(unflaggedProgram, unflaggedRun)).not.toContain('personality-card')
  })
})
