import { describe, expect, it } from 'vitest'
import {
  EMPTY_SHOP,
  ACHIEVEMENT_LIMIT,
  achievementId,
  achievementSaveProblem,
  defaultAchievementCondition,
  everyOptionGated,
  isImageIcon,
  moveAchievement,
  moveShopItem,
  newAchievement,
  newOptionUnlock,
  normalizeAchievementsDraft,
  normalizeMapDraft,
  normalizePersonalityDraft,
  normalizeShopDraft,
  personalityEntryOf,
  restoreAllPersonalityEntries,
  restorePersonalityEntry,
  sanitizeAchievement,
  sanitizeAchievements,
  sanitizeMap,
  sanitizePersonality,
  sanitizeReward,
  sanitizeShop,
  sanitizeShopItem,
  sanitizeVariable,
  sanitizeVariables,
  savePointCount,
  setAchievementConditionType,
  setAchievementValueVariable,
  setUnlockMode,
  setVariableType,
  shopItemId,
  shopItemNameProblem,
  togglePersonalityTag,
  variableMaxWarning,
  variableNameProblem,
  withOptionTags,
  withOptionUnlock,
  withPersonalityEntry,
} from '@/features/interactive/gameplay-edit'
import { parseStoryConfigInput } from '@/lib/interactive/config'
import type { StoryPlaces } from '@/lib/interactive/places'
import type { StoryAchievement, StoryShop, StoryShopItem, StoryVariable } from '@/lib/interactive/types'

const variable = (patch: Partial<StoryVariable> = {}): StoryVariable =>
  ({ id: 'v1', name: '勇气', type: 'number', initial: 0, ...patch })
const item = (patch: Partial<StoryShopItem> = {}): StoryShopItem =>
  ({ id: 'shop_1', name: '钥匙', icon: null, description: '', price: 1, limit: 1, effects: [], ...patch })

describe('gameplay edit variables', () => {
  it('keeps the existing name rules', () => {
    expect(variableNameProblem([])).toBeNull()
    expect(variableNameProblem([variable()])).toBeNull()
    expect(variableNameProblem([variable({ name: ' ' })])).toBe('变量名称不能为空')
    expect(variableNameProblem([variable({ name: 'x'.repeat(25) })])).toBe('变量名称不能超过 24 个字')
    expect(variableNameProblem([variable(), variable({ id: 'v2', name: ' 勇气 ' })])).toBe('变量「勇气」重名')
  })

  it('warns inline when the start is above the cap', () => {
    expect(variableMaxWarning(variable({ initial: 4, max: 3 }))).toContain('高于上限 3')
    expect(variableMaxWarning(variable({ initial: 3, max: 3 }))).toBeNull()
    expect(variableMaxWarning(variable({ type: 'boolean', initial: true }))).toBeNull()
    expect(variableMaxWarning(variable({ initial: 4 }))).toBeNull()
  })

  it('drops the cap when switching to a switch and keeps the presentation extras', () => {
    const next = setVariableType(variable({ initial: 5, max: 9, icon: '🪙', showInHud: true, scope: 'permanent' }), 'boolean')
    expect(next).toEqual({ id: 'v1', name: '勇气', type: 'boolean', initial: false, icon: '🪙', showInHud: true, scope: 'permanent' })
    expect('max' in next).toBe(false)
    const back = setVariableType(next, 'number')
    expect(back).toEqual({ id: 'v1', name: '勇气', type: 'number', initial: 0, icon: '🪙', showInHud: true, scope: 'permanent' })
    expect(setVariableType(back, 'number')).toBe(back)
  })

  it('only writes new keys when they are set', () => {
    expect(sanitizeVariable(variable())).toEqual({ id: 'v1', name: '勇气', type: 'number', initial: 0 })
    expect(sanitizeVariable(variable({ icon: '  ', showInHud: false, scope: 'run', max: null })))
      .toEqual({ id: 'v1', name: '勇气', type: 'number', initial: 0 })
    expect(sanitizeVariable(variable({ icon: ' 🪙 ', showInHud: true, scope: 'permanent', max: 9, initial: 2 })))
      .toEqual({ id: 'v1', name: '勇气', type: 'number', initial: 2, max: 9, icon: '🪙', showInHud: true, scope: 'permanent' })
    expect(sanitizeVariable(variable({ type: 'boolean', initial: 1 as unknown as boolean })))
      .toEqual({ id: 'v1', name: '勇气', type: 'boolean', initial: false })
    expect(sanitizeVariables(Array.from({ length: 60 }, (_, index) => variable({ id: `v${index}` })))).toHaveLength(50)
  })
})

describe('gameplay edit shop', () => {
  it('clamps every numeric field and trims text', () => {
    expect(sanitizeShopItem(item({ name: ` ${'钥匙'.repeat(20)} `, description: 'x'.repeat(200), price: 1_234_567.899, limit: 500, icon: ' 🔑 ' })))
      .toEqual({
        id: 'shop_1',
        name: '钥匙'.repeat(12),
        icon: '🔑',
        description: 'x'.repeat(120),
        price: 999_999,
        limit: 99,
        effects: [],
      })
    expect(sanitizeShopItem(item({ price: -3, limit: -2, icon: '  ' })).price).toBe(0)
    expect(sanitizeShopItem(item({ price: 1.235 })).price).toBe(1.24)
    expect(sanitizeShopItem(item({ price: 1.234 })).price).toBe(1.23)
    expect(sanitizeShopItem(item({ limit: 0 })).limit).toBe(0)
  })

  it('drops duplicate ids, caps the list and keeps effects valid', () => {
    const many = Array.from({ length: 40 }, (_, index) => item({ id: index === 1 ? 'shop_1' : `shop_${index}` }))
    const shop = sanitizeShop({ enabled: true, currencyVariableId: 'coin', items: many })
    expect(shop.items).toHaveLength(30)
    expect(new Set(shop.items.map((entry) => entry.id)).size).toBe(30)
    const sanitized = sanitizeShop({
      enabled: false,
      currencyVariableId: '',
      items: [item({ effects: [{ variableId: 'v1', op: 'add', value: Number.NaN }, { variableId: 'v2', op: 'set', value: true }] })],
    })
    expect(sanitized).toEqual({
      enabled: false,
      currencyVariableId: null,
      items: [{ ...item(), effects: [{ variableId: 'v1', op: 'add', value: 0 }, { variableId: 'v2', op: 'set', value: true }] }],
    })
  })

  it('normalizes an absent shop without aliasing the stored items', () => {
    expect(normalizeShopDraft(undefined)).toEqual(EMPTY_SHOP)
    const stored: StoryShop = { enabled: true, currencyVariableId: null, items: [item({ effects: [{ variableId: 'v1', op: 'add', value: 1 }] })] }
    const draft = normalizeShopDraft(stored)
    draft.items[0].effects[0].value = 9
    expect(stored.items[0].effects[0].value).toBe(1)
  })

  it('validates names, generates server-safe ids and moves items', () => {
    expect(shopItemNameProblem({ ...EMPTY_SHOP, items: [item({ name: ' ' })] })).toBe('每件商品都需要名称')
    expect(shopItemNameProblem({ ...EMPTY_SHOP, items: [item()] })).toBeNull()
    expect(shopItemId('a1b2c3d4-e5f6')).toBe('shop_a1b2c3d4')
    expect(shopItemId('---')).toBe('shop_00000000')
    expect(shopItemId('ab')).toMatch(/^[A-Za-z0-9_-]{1,64}$/)
    const items = [item({ id: 'a' }), item({ id: 'b' }), item({ id: 'c' })]
    expect(moveShopItem(items, 0, 1).map((entry) => entry.id)).toEqual(['b', 'a', 'c'])
    expect(moveShopItem(items, 2, -2).map((entry) => entry.id)).toEqual(['c', 'a', 'b'])
    expect(moveShopItem(items, 0, -1)).toBe(items)
    expect(moveShopItem(items, 2, 1)).toBe(items)
  })
})

describe('gameplay edit unlocks', () => {
  it('starts as a locked rule on the first variable', () => {
    expect(newOptionUnlock([])).toBeNull()
    expect(newOptionUnlock([variable()])).toEqual({ mode: 'locked', match: 'all', conditions: [{ variableId: 'v1', op: '>=', value: 1 }], shopItemId: null })
    expect(newOptionUnlock([variable({ type: 'boolean', id: 'b1' })]))
      .toEqual({ mode: 'locked', match: 'all', conditions: [{ variableId: 'b1', op: '==', value: true }], shopItemId: null })
  })

  it('drops the shop link when the option becomes hidden', () => {
    const unlock = { mode: 'locked' as const, match: 'all' as const, conditions: [{ variableId: 'v1', op: '>=' as const, value: 1 }], shopItemId: 'shop_1' }
    expect(setUnlockMode(unlock, 'hidden')).toEqual({ ...unlock, mode: 'hidden', shopItemId: null })
    expect(setUnlockMode({ ...unlock, mode: 'hidden', shopItemId: null }, 'locked').shopItemId).toBeNull()
  })

  it('clears the unlock key instead of writing undefined', () => {
    const option = { id: 'o1', label: '开门', effects: [], imageUrl: null, when: 'now' as const, retry: false }
    const withRule = withOptionUnlock(option, newOptionUnlock([variable()]))
    expect(withRule.unlock?.conditions).toHaveLength(1)
    const cleared = withOptionUnlock(withRule, null)
    expect('unlock' in cleared).toBe(false)
    expect(cleared).toEqual(option)
    expect(withOptionUnlock(option, null)).not.toBe(option)
  })

  it('detects a choice whose every option is gated', () => {
    expect(everyOptionGated([])).toBe(false)
    expect(everyOptionGated([{ unlock: undefined }, { unlock: newOptionUnlock([variable()]) ?? undefined }])).toBe(false)
    expect(everyOptionGated([{ unlock: newOptionUnlock([variable()]) ?? undefined }])).toBe(true)
  })

  it('tells pictures apart from emoji', () => {
    expect(isImageIcon('🪙')).toBe(false)
    expect(isImageIcon(null)).toBe(false)
    expect(isImageIcon('https://cdn.example.com/icon.png')).toBe(true)
    expect(isImageIcon('/uploads/icon.png')).toBe(true)
    expect(isImageIcon('data:image/png;base64,AAA')).toBe(true)
  })
})

const achievement = (patch: Partial<StoryAchievement> = {}): StoryAchievement => ({
  id: 'ach_1',
  name: '好结局',
  description: '',
  icon: null,
  condition: { type: 'ending', projectId: 'p', nodeId: 'good' },
  reward: { title: '', frameUrl: null },
  ...patch,
})

const PLACES: StoryPlaces = {
  endings: [
    { kind: 'ending', projectId: 'p', nodeId: 'good', key: 'p:good', title: '好结局', chapterTitle: '章', endingType: 'good', label: '好结局' },
    { kind: 'ending', projectId: 'p', nodeId: 'bad', key: 'p:bad', title: '坏结局', chapterTitle: '章', endingType: 'bad', label: '坏结局' },
  ],
  segments: [
    { kind: 'segment', projectId: 'p', nodeId: 's1', key: 'p:s1', title: '雨夜', chapterTitle: '章', endingType: null, label: '雨夜' },
  ],
}

describe('gameplay edit shop rewards', () => {
  it('keeps a reward that has a title or a frame and omits an empty one', () => {
    expect(sanitizeReward({ title: '  最强王者 ', frameUrl: ' /gold.png ' })).toEqual({ title: '最强王者', frameUrl: '/gold.png' })
    expect(sanitizeReward({ title: '一'.repeat(30), frameUrl: null })?.title).toHaveLength(12)
    expect(sanitizeReward({ title: '王者', frameUrl: null })).toEqual({ title: '王者', frameUrl: null })
    expect(sanitizeReward({ title: '', frameUrl: '/gold.png' })).toEqual({ title: '', frameUrl: '/gold.png' })
    expect(sanitizeReward({ title: '   ', frameUrl: null })).toBeUndefined()
    expect(sanitizeReward(undefined)).toBeUndefined()
    expect(sanitizeShopItem(item({ reward: { title: '王者', frameUrl: '/gold.png' } })).reward).toEqual({ title: '王者', frameUrl: '/gold.png' })
    expect('reward' in sanitizeShopItem(item({ reward: { title: ' ', frameUrl: null } }))).toBe(false)
  })

  it('copies a reward into the draft so editing never aliases the stored item', () => {
    const stored: StoryShop = { enabled: true, currencyVariableId: null, items: [item({ reward: { title: '王者', frameUrl: null } })] }
    const draft = normalizeShopDraft(stored)
    draft.items[0].reward!.title = '新称号'
    expect(stored.items[0].reward?.title).toBe('王者')
  })
})

describe('gameplay edit achievements', () => {
  it('keeps each condition kind in the shape the server stores', () => {
    expect(sanitizeAchievement(achievement())?.condition).toEqual({ type: 'ending', projectId: 'p', nodeId: 'good' })
    expect(sanitizeAchievement(achievement({ condition: { type: 'segment', projectId: ' p ', nodeId: ' s1 ' } }))?.condition)
      .toEqual({ type: 'segment', projectId: 'p', nodeId: 's1' })
    expect(sanitizeAchievement(achievement({ condition: { type: 'value', variableId: 'coin', op: '>', value: 3 } }))?.condition)
      .toEqual({ type: 'value', variableId: 'coin', op: '>', value: 3 })
    expect(sanitizeAchievement(achievement({ condition: { type: 'all_endings' } }))?.condition).toEqual({ type: 'all_endings' })
    expect(sanitizeAchievement(achievement({ condition: { type: 'all_achievements' } }))?.condition).toEqual({ type: 'all_achievements' })
  })

  it('trims text, caps it and always fills the reward key', () => {
    const clean = sanitizeAchievement(achievement({
      name: `  ${'名'.repeat(40)}  `,
      description: ` ${'述'.repeat(300)} `,
      icon: ' 🏆 ',
      reward: { title: '最强王者最强王者', frameUrl: '/crown.png' },
    }))
    expect(clean?.name).toHaveLength(24)
    expect(clean?.description).toHaveLength(120)
    expect(clean?.icon).toBe('🏆')
    expect(clean?.reward).toEqual({ title: '最强王者最强王者', frameUrl: '/crown.png' })
    expect(sanitizeAchievement(achievement())?.reward).toEqual({ title: '', frameUrl: null })
    expect('reward' in (sanitizeAchievement(achievement({ reward: { title: '', frameUrl: null } })) ?? {})).toBe(true)
  })

  it('drops malformed entries and repeated ids, and stops at the limit', () => {
    expect(sanitizeAchievement(achievement({ id: 'bad id' }))).toBeNull()
    expect(sanitizeAchievement(achievement({ name: '  ' }))).toBeNull()
    expect(sanitizeAchievement(achievement({ condition: { type: 'ending', projectId: 'p', nodeId: '' } }))).toBeNull()
    expect(sanitizeAchievement(achievement({ condition: { type: 'value', variableId: 'bad var', op: '>=', value: 1 } }))).toBeNull()
    expect(sanitizeAchievements([achievement({ id: 'a' }), achievement({ id: 'a', name: '另一个' })])).toHaveLength(1)
    const many = Array.from({ length: ACHIEVEMENT_LIMIT + 5 }, (_, index) => achievement({ id: `a${index}` }))
    expect(sanitizeAchievements(many)).toHaveLength(ACHIEVEMENT_LIMIT)
  })

  it('blocks the save while a card is unfinished', () => {
    expect(achievementSaveProblem([])).toBeNull()
    expect(achievementSaveProblem([achievement()])).toBeNull()
    expect(achievementSaveProblem([achievement({ name: ' ' })])).toBe('每个成就都需要名称')
    expect(achievementSaveProblem([achievement({ condition: { type: 'ending', projectId: '', nodeId: '' } })])).toContain('还没有选择结局')
    expect(achievementSaveProblem([achievement({ condition: { type: 'value', variableId: '', op: '>=', value: 1 } })])).toContain('还没有选择数值')
  })

  it('creates valid ids and defaults a new card to a reachable place', () => {
    expect(achievementId('a1b2-c3d4')).toBe('ach_a1b2c3d4')
    expect(achievementId('---')).toBe('ach_00000000')
    expect(achievementId(crypto.randomUUID().slice(0, 8))).toMatch(/^[A-Za-z0-9_-]{1,64}$/)
    expect(new Set([achievementId(crypto.randomUUID().slice(0, 8)), achievementId(crypto.randomUUID().slice(0, 8))]).size).toBe(2)
    expect(defaultAchievementCondition(PLACES)).toEqual({ type: 'ending', projectId: 'p', nodeId: 'good' })
    expect(defaultAchievementCondition({ endings: [], segments: PLACES.segments })).toEqual({ type: 'segment', projectId: 'p', nodeId: 's1' })
    expect(defaultAchievementCondition({ endings: [], segments: [] })).toEqual({ type: 'all_endings' })
    expect(newAchievement('ach_x', '成就', PLACES)).toMatchObject({ id: 'ach_x', name: '成就', icon: null, reward: { title: '', frameUrl: null } })
  })

  it('switches condition kinds onto a usable sub-condition', () => {
    expect(setAchievementConditionType(achievement().condition, 'segment', PLACES, [])).toEqual({ type: 'segment', projectId: 'p', nodeId: 's1' })
    expect(setAchievementConditionType(achievement().condition, 'value', PLACES, [variable({ id: 'coin' })]))
      .toEqual({ type: 'value', variableId: 'coin', op: '>=', value: 1 })
    expect(setAchievementConditionType(achievement().condition, 'value', PLACES, [variable({ id: 'seen', type: 'boolean', initial: false })]))
      .toEqual({ type: 'value', variableId: 'seen', op: '==', value: true })
    expect(setAchievementConditionType(achievement().condition, 'all_endings', PLACES, [])).toEqual({ type: 'all_endings' })
    const value = { type: 'value' as const, variableId: 'coin', op: '>=' as const, value: 2 }
    expect(setAchievementValueVariable(value, variable({ id: 'seen', type: 'boolean', initial: false })))
      .toEqual({ type: 'value', variableId: 'seen', op: '==', value: false })
    expect(setAchievementValueVariable({ ...value, op: '>', value: true }, variable({ id: 'coin' })))
      .toEqual({ type: 'value', variableId: 'coin', op: '>', value: 1 })
  })

  it('reorders cards without mutating the draft', () => {
    const list = [achievement({ id: 'a' }), achievement({ id: 'b' }), achievement({ id: 'c' })]
    expect(moveAchievement(list, 0, 1).map((entry) => entry.id)).toEqual(['b', 'a', 'c'])
    expect(moveAchievement(list, 2, 1)).toBe(list)
    const copy = normalizeAchievementsDraft(list)
    copy[0].condition = { type: 'all_endings' }
    expect(list[0].condition.type).toBe('ending')
  })
})

describe('gameplay edit personality test', () => {
  it('persists only the types the creator actually wrote', () => {
    const clean = sanitizePersonality({
      enabled: true,
      results: {
        ENFP: { name: ' 热情家 ', description: ' 一路热情。 ', imageUrl: ' /enfp.png ' },
        ISTJ: { name: '', description: '', imageUrl: null },
        XXXX: { name: '不存在', description: '', imageUrl: null },
      },
    })
    expect(clean).toEqual({ enabled: true, results: { ENFP: { name: '热情家', description: '一路热情。', imageUrl: '/enfp.png' } } })
    expect(sanitizePersonality({ enabled: 'yes' as unknown as boolean, results: {} })).toEqual({ enabled: false, results: {} })
    expect(sanitizePersonality(undefined)).toEqual({ enabled: false, results: {} })
  })

  it('caps copy and drops an entry that becomes empty in the editor', () => {
    const long = sanitizePersonality({ enabled: true, results: { INFJ: { name: '名'.repeat(60), description: '述'.repeat(900), imageUrl: '' } } })
    expect(long.results.INFJ.name).toHaveLength(24)
    expect(long.results.INFJ.description).toHaveLength(300)
    expect(long.results.INFJ.imageUrl).toBeNull()
    const draft = normalizePersonalityDraft({ enabled: true, results: { ENFP: { name: '热情家', description: '', imageUrl: null } } })
    expect(personalityEntryOf(draft, 'ENFP')).toEqual({ name: '热情家', description: '', imageUrl: null })
    expect(personalityEntryOf(draft, 'ISTJ')).toEqual({ name: '', description: '', imageUrl: null })
    const cleared = withPersonalityEntry(draft, 'ENFP', { name: '  ', description: '', imageUrl: null })
    expect('ENFP' in cleared.results).toBe(false)
    const restored = restorePersonalityEntry(draft, 'ENFP')
    expect('ENFP' in restored.results).toBe(false)
    expect(restoreAllPersonalityEntries(draft).results).toEqual({})
  })
})

describe('gameplay edit map', () => {
  it('normalizes the switch and leaves old configs untouched', () => {
    expect(normalizeMapDraft(undefined)).toEqual({ enabled: false })
    expect(sanitizeMap({ enabled: true })).toEqual({ enabled: true })
    expect(sanitizeMap({ enabled: 1 as unknown as boolean })).toEqual({ enabled: false })
    expect(savePointCount([])).toBe(0)
    expect(savePointCount([
      { nodes: [{ kind: 'scene', savePoint: { name: '雨夜', coverUrl: null } }, { kind: 'ending' }, { kind: 'scene' }] },
      { nodes: [{ kind: 'scene', savePoint: { name: '街角', coverUrl: null } }] },
    ])).toBe(2)
  })
})

describe('gameplay edit personality tags', () => {
  it('keeps one letter per pair and clears on a second click', () => {
    expect(togglePersonalityTag(undefined, 'E')).toEqual(['E'])
    expect(togglePersonalityTag(['E'], 'I')).toEqual(['I'])
    expect(togglePersonalityTag(['I'], 'I')).toEqual([])
    expect(togglePersonalityTag(['E', 'S'], 'N')).toEqual(['E', 'N'])
    expect(togglePersonalityTag(['P', 'E'], 'S')).toEqual(['E', 'S', 'P'])
    expect(togglePersonalityTag(['E', 'S', 'T', 'J'], 'F')).toEqual(['E', 'S', 'F', 'J'])
  })

  it('removes the tags key instead of writing an empty array', () => {
    const option = { id: 'o1', label: '开门', effects: [], imageUrl: null, when: 'now' as const, retry: false }
    const tagged = withOptionTags(option, ['E', 'N'])
    expect(tagged.tags).toEqual(['E', 'N'])
    const cleared = withOptionTags(tagged, [])
    expect('tags' in cleared).toBe(false)
    expect(cleared).toEqual(option)
  })
})

describe('gameplay edit patches survive the server rules unchanged', () => {
  it('accepts sanitized achievements, personality, map and shop rewards as-is', () => {
    const patch = {
      variables: [variable({ id: 'coin', name: '金币' })],
      achievements: sanitizeAchievements([
        achievement({ id: 'a1', condition: { type: 'ending', projectId: 'p', nodeId: 'good' }, reward: { title: '最强王者', frameUrl: '/gold.png' } }),
        achievement({ id: 'a2', condition: { type: 'segment', projectId: 'p', nodeId: 's1' } }),
        achievement({ id: 'a3', condition: { type: 'value', variableId: 'coin', op: '>', value: 3 } }),
        achievement({ id: 'a4', condition: { type: 'all_endings' } }),
        achievement({ id: 'a5', condition: { type: 'all_achievements' } }),
      ]),
      personality: sanitizePersonality({ enabled: true, results: { ENFP: { name: '热情家', description: '一路热情。', imageUrl: '/enfp.png' } } }),
      map: sanitizeMap({ enabled: true }),
      shop: sanitizeShop({ enabled: true, currencyVariableId: 'coin', items: [item({ reward: { title: '', frameUrl: '/frame.png' } })] }),
    }
    const result = parseStoryConfigInput(patch)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.config.achievements).toEqual(patch.achievements)
    expect(result.config.personality).toEqual(patch.personality)
    expect(result.config.map).toEqual(patch.map)
    expect(result.config.shop).toEqual(patch.shop)
    expect(JSON.parse(JSON.stringify(result.config))).toEqual(result.config)
  })

  it('accepts an empty achievements list without inventing keys', () => {
    const result = parseStoryConfigInput({ variables: [], achievements: sanitizeAchievements([]) })
    expect(result.ok && result.config.achievements).toEqual([])
    expect(result.ok && 'personality' in result.config).toBe(false)
    expect(result.ok && 'map' in result.config).toBe(false)
  })
})
