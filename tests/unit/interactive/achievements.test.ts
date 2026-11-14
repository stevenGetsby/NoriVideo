import { describe, expect, it } from 'vitest'
import { advanceRun, startRun, type StoryRun } from '@/lib/interactive/engine'
import {
  achievementProgress,
  cosmeticsOf,
  emptyProfile,
  endingAchievementOf,
  endingKeys,
  equipCosmetic,
  equippedLook,
  observeRun,
  reachKey,
  readProfile,
  recordShopReward,
  toggleEndingAchievement,
  type StoryProfile,
} from '@/lib/interactive/achievements'
import type { StoryAchievement, StoryProgram, StoryShop } from '@/lib/interactive/types'
import { achievements, storyProgram } from './p3-fixture'

/** s1 → pick → (a|b|c) → s2 / badend → goodend, one stop at a time. */
function walk(program: StoryProgram, picks: string[]): StoryRun[] {
  const runs = [startRun(program, { mode: 'story' })]
  let run = runs[0]
  run = advanceRun(program, run)
  runs.push(run)
  run = advanceRun(program, run, picks[0])
  runs.push(run)
  while (run.stop.kind === 'scene') {
    run = advanceRun(program, run)
    runs.push(run)
  }
  return runs
}

function observeAll(program: StoryProgram, profile: StoryProfile, runs: StoryRun[]) {
  const earned: string[] = []
  let current = profile
  for (const run of runs) {
    const update = observeRun(program, current, run)
    current = update.profile
    earned.push(...update.earned.map((item) => item.id))
  }
  return { profile: current, earned }
}

describe('the viewer profile', () => {
  it('reads anything malformed as an empty profile', () => {
    for (const raw of [null, undefined, 'x', 3, [], true]) expect(readProfile(raw)).toEqual(emptyProfile())
  })

  it('keeps what is usable and drops the rest', () => {
    const profile = readProfile({
      endings: ['p:end', 'p:end', 3, '', null],
      segments: 'nope',
      achievements: ['a'],
      bought: ['x', 'x'],
      equipped: { title: 'a:a', frame: '' },
    })
    expect(profile).toEqual({ endings: ['p:end'], segments: [], achievements: ['a'], bought: ['x'], equipped: { title: 'a:a', frame: null } })
  })

  it('caps the long lists a hostile storage could hold', () => {
    const many = Array.from({ length: 5000 }, (_, index) => `p:${index}`)
    expect(readProfile({ endings: many }).endings).toHaveLength(2000)
  })

  it('builds the same key everywhere', () => {
    expect(reachKey('p', 'n')).toBe('p:n')
    expect(endingKeys(storyProgram())).toEqual(['p:goodend', 'p:badend'])
  })
})

describe('earning achievements while playing', () => {
  it('remembers the segments and endings a run reaches, and returns the same profile when nothing is new', () => {
    const program = storyProgram({ achievements: [] })
    const runs = walk(program, ['a'])
    const first = observeRun(program, emptyProfile(), runs[0])
    expect(first.profile.segments).toEqual(['p:s1'])
    const again = observeRun(program, first.profile, runs[0])
    expect(again.profile).toBe(first.profile)
    const atPick = observeRun(program, first.profile, runs[1])
    expect(atPick.profile).toBe(first.profile)
    const end = observeAll(program, emptyProfile(), runs)
    expect(end.profile.segments).toEqual(['p:s1', 'p:s2'])
    expect(end.profile.endings).toEqual(['p:goodend'])
  })

  it('earns each achievement the moment its condition holds, in the order they are listed', () => {
    const program = storyProgram({ achievements })
    const runs = walk(program, ['a'])
    expect(observeRun(program, emptyProfile(), runs[0]).earned).toEqual([])
    const atCorner = observeAll(program, emptyProfile(), runs.slice(0, 3))
    expect(atCorner.earned).toEqual(['a_seg', 'a_rich'])
    expect(observeAll(program, emptyProfile(), runs).earned).toEqual(['a_seg', 'a_rich', 'a_good'])
  })

  it('waits for every ending across plays, then settles "finish all achievements" in the same call', () => {
    const program = storyProgram({ achievements })
    const first = observeAll(program, emptyProfile(), walk(program, ['a']))
    expect(first.profile.achievements).not.toContain('a_ends')
    const second = observeAll(program, first.profile, walk(program, ['c']))
    expect(second.earned).toEqual(['a_bad', 'a_ends', 'a_all'])
    expect(achievementProgress(program, second.profile)).toEqual({ earned: 6, total: 6 })
  })

  it('never earns the same achievement twice', () => {
    const program = storyProgram({ achievements })
    const first = observeAll(program, emptyProfile(), walk(program, ['a']))
    const replay = observeAll(program, first.profile, walk(program, ['a']))
    expect(replay.earned).toEqual([])
    expect(replay.profile.achievements).toEqual(first.profile.achievements)
  })

  it('counts a value achievement from the current run and never takes an earned one back', () => {
    const program = storyProgram({ achievements })
    const first = observeAll(program, emptyProfile(), walk(program, ['a']))
    expect(first.profile.achievements).toContain('a_rich')
    const poorRun = startRun(program, { mode: 'story' })
    expect(poorRun.vars.coin).toBe(0)
    expect(observeRun(program, first.profile, poorRun).profile.achievements).toContain('a_rich')
  })

  it('does not fire "all endings" or "all achievements" when there is nothing to collect', () => {
    const onlyAll: StoryAchievement[] = [
      { id: 'x', name: '全成就', description: '', icon: null, condition: { type: 'all_achievements' }, reward: { title: '', frameUrl: null } },
    ]
    const program = storyProgram({ achievements: onlyAll })
    expect(observeAll(program, emptyProfile(), walk(program, ['a'])).earned).toEqual([])
    const noEndings: StoryProgram = { ...program, chapters: [{ ...program.chapters[0], nodes: program.chapters[0].nodes.filter((node) => node.kind !== 'ending') }] }
    const allEnds: StoryAchievement[] = [
      { id: 'y', name: '全结局', description: '', icon: null, condition: { type: 'all_endings' }, reward: { title: '', frameUrl: null } },
    ]
    expect(observeRun({ ...noEndings, achievements: allEnds }, emptyProfile(), startRun(program, { mode: 'story' })).earned).toEqual([])
  })

  it('does not fire a value achievement that names a value the story no longer has', () => {
    const ghost: StoryAchievement[] = [
      { id: 'g', name: '幽灵', description: '', icon: null, condition: { type: 'value', variableId: 'gone', op: '>=', value: 0 }, reward: { title: '', frameUrl: null } },
    ]
    const program = storyProgram({ achievements: ghost })
    expect(observeAll(program, emptyProfile(), walk(program, ['a'])).earned).toEqual([])
  })

  it('puts a fresh reward on at once, unless something is already worn in that place', () => {
    const program = storyProgram({ achievements })
    const afterCorner = observeAll(program, emptyProfile(), walk(program, ['a']).slice(0, 3)).profile
    expect(afterCorner.equipped).toEqual({ title: 'a:a_rich', frame: null })
    const afterEnding = observeAll(program, afterCorner, walk(program, ['a'])).profile
    expect(afterEnding.equipped).toEqual({ title: 'a:a_rich', frame: 'a:a_good' })
    const everything = observeAll(program, afterEnding, walk(program, ['c'])).profile
    expect(everything.equipped).toEqual({ title: 'a:a_rich', frame: 'a:a_good' })
  })
})

describe('titles and avatar frames', () => {
  const program = storyProgram({ achievements })
  const profile = observeAll(program, emptyProfile(), [...walk(program, ['a']), ...walk(program, ['c'])]).profile

  it('lists what the viewer owns, earned ones first, skipping achievements without a reward', () => {
    expect(cosmeticsOf(program, profile).map((item) => item.id)).toEqual(['a:a_good', 'a:a_rich', 'a:a_ends', 'a:a_all'])
    expect(cosmeticsOf(program, emptyProfile())).toEqual([])
  })

  it('shows what the avatar wears', () => {
    expect(equippedLook(program, profile)).toEqual({ title: '富翁', frameUrl: '/gold.png' })
    expect(equippedLook(program, emptyProfile())).toEqual({ title: null, frameUrl: null })
  })

  it('lets the viewer swap, take off, and refuses what they do not own or what has no such part', () => {
    expect(equippedLook(program, equipCosmetic(program, profile, 'title', 'a:a_all')).title).toBe('通关达人')
    expect(equippedLook(program, equipCosmetic(program, profile, 'frame', 'a:a_all')).frameUrl).toBe('/crown.png')
    expect(equipCosmetic(program, profile, 'frame', 'a:a_rich')).toBe(profile)
    expect(equipCosmetic(program, profile, 'title', 's:nothing')).toBe(profile)
    expect(equipCosmetic(program, emptyProfile(), 'title', 'a:a_all').equipped.title).toBeNull()
    const bare = equipCosmetic(program, profile, 'frame', null)
    expect(bare.equipped).toEqual({ title: 'a:a_rich', frame: null })
    expect(equippedLook(program, bare).frameUrl).toBeNull()
  })

  it('wears nothing for a reward whose achievement was deleted', () => {
    const trimmed = storyProgram({ achievements: achievements.filter((item) => item.id !== 'a_good') })
    expect(equippedLook(trimmed, profile).frameUrl).toBeNull()
  })
})

describe('rewards bought in the shop', () => {
  const shop: StoryShop = {
    enabled: true,
    currencyVariableId: 'coin',
    items: [
      { id: 'crown', name: '王冠', icon: null, description: '', price: 1, limit: 1, effects: [], reward: { title: '陛下', frameUrl: '/crown.png' } },
      { id: 'potion', name: '药水', icon: null, description: '', price: 1, limit: 0, effects: [{ variableId: 'coin', op: 'add', value: 1 }] },
      { id: 'hat', name: '帽子', icon: null, description: '', price: 1, limit: 1, effects: [], reward: { title: '', frameUrl: '/hat.png' } },
    ],
  }
  const program = storyProgram({ shop, achievements })

  it('keeps a bought title or frame for good and puts it on when the place is empty', () => {
    const bought = recordShopReward(program, emptyProfile(), 'crown')
    expect(bought.bought).toEqual(['crown'])
    expect(bought.equipped).toEqual({ title: 's:crown', frame: 's:crown' })
    expect(cosmeticsOf(program, bought).map((item) => [item.id, item.source, item.name])).toEqual([['s:crown', 'shop', '王冠']])
    expect(equippedLook(program, bought)).toEqual({ title: '陛下', frameUrl: '/crown.png' })
  })

  it('does not take over a place that is already worn', () => {
    const wearing = recordShopReward(program, emptyProfile(), 'hat')
    const both = recordShopReward(program, wearing, 'crown')
    expect(both.equipped).toEqual({ title: 's:crown', frame: 's:hat' })
  })

  it('ignores items without a reward, unknown items and ones already bought', () => {
    const profile = emptyProfile()
    expect(recordShopReward(program, profile, 'potion')).toBe(profile)
    expect(recordShopReward(program, profile, 'missing')).toBe(profile)
    const bought = recordShopReward(program, profile, 'crown')
    expect(recordShopReward(program, bought, 'crown')).toBe(bought)
    expect(recordShopReward(storyProgram(), profile, 'crown')).toBe(profile)
  })

  it('lists earned rewards before bought ones', () => {
    const bought = recordShopReward(program, emptyProfile(), 'crown')
    const earned = observeAll(program, bought, walk(program, ['a'])).profile
    expect(cosmeticsOf(program, earned).map((item) => item.id)).toEqual(['a:a_good', 'a:a_rich', 's:crown'])
  })
})

describe('the ending switch 「设为成就」', () => {
  const ending = { projectId: 'p', nodeId: 'goodend', title: ' 好结局 ' }

  it('adds an achievement named after the ending, and removes it on the next press', () => {
    const added = toggleEndingAchievement(undefined, ending, () => 'new-id')
    expect(added).toEqual([{
      id: 'new-id',
      name: '好结局',
      description: '',
      icon: null,
      condition: { type: 'ending', projectId: 'p', nodeId: 'goodend' },
      reward: { title: '', frameUrl: null },
    }])
    expect(endingAchievementOf(added, 'p', 'goodend')?.id).toBe('new-id')
    expect(toggleEndingAchievement(added, ending, () => 'other')).toEqual([])
  })

  it('leaves the other achievements alone and finds only the matching ending', () => {
    const list = toggleEndingAchievement(achievements, { projectId: 'p', nodeId: 'extra', title: '' }, () => 'e1')
    expect(list).toHaveLength(achievements.length + 1)
    expect(list[list.length - 1].name).toBe('结局')
    expect(toggleEndingAchievement(list, { projectId: 'p', nodeId: 'extra', title: '' }, () => 'e2')).toEqual(achievements)
    expect(endingAchievementOf(achievements, 'p', 'goodend')?.id).toBe('a_good')
    expect(endingAchievementOf(achievements, 'p', 's2')).toBeUndefined()
    expect(endingAchievementOf(undefined, 'p', 'goodend')).toBeUndefined()
    expect(endingAchievementOf(achievements, 'q', 'goodend')).toBeUndefined()
  })
})
