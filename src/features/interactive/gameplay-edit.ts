import {
  STORY_ACHIEVEMENT_DESCRIPTION_MAX,
  STORY_ACHIEVEMENT_LIMIT,
  STORY_ACHIEVEMENT_NAME_MAX,
  STORY_ICON_MAX,
  STORY_PERSONALITY_DESCRIPTION_MAX,
  STORY_PERSONALITY_NAME_MAX,
  STORY_REWARD_TITLE_MAX,
  STORY_SHOP_ITEM_DESCRIPTION_MAX,
  STORY_SHOP_ITEM_LIMIT,
  STORY_SHOP_ITEM_NAME_MAX,
  STORY_SHOP_ITEM_PURCHASE_MAX,
  STORY_SHOP_PRICE_MAX,
  STORY_VARIABLE_LIMIT,
  STORY_VARIABLE_NAME_MAX,
} from '@/lib/interactive/config'
import { STORY_PERSONALITY_TYPES } from '@/lib/interactive/personality'
import { playbackSpeeds } from '@/lib/interactive/playback'
import type { StoryPlaces } from '@/lib/interactive/places'
import {
  STORY_COMPARE_OPS,
  STORY_PERSONALITY_AXES,
  STORY_PERSONALITY_TAGS,
  type StoryAchievement,
  type StoryAchievementCondition,
  type StoryAchievementConditionType,
  type StoryMapConfig,
  type StoryPersonality,
  type StoryPersonalityResult,
  type StoryPersonalityTag,
  type StoryReward,
  type StoryChoiceOption,
  type StoryCondition,
  type StoryEffect,
  type StoryOptionUnlock,
  type StoryPlaybackConfig,
  type StoryPlaybackSpeed,
  type StoryShop,
  type StoryShopItem,
  type StoryUnlockMode,
  type StoryVariable,
  type StoryVariableType,
  type StoryValue,
} from '@/lib/interactive/types'

export const VARIABLE_LIMIT = STORY_VARIABLE_LIMIT
export const VARIABLE_NAME_MAX = STORY_VARIABLE_NAME_MAX
export const SHOP_ITEM_LIMIT = STORY_SHOP_ITEM_LIMIT
export const SHOP_ITEM_NAME_MAX = STORY_SHOP_ITEM_NAME_MAX
export const SHOP_ITEM_DESCRIPTION_MAX = STORY_SHOP_ITEM_DESCRIPTION_MAX
export const SHOP_PRICE_MAX = STORY_SHOP_PRICE_MAX
export const SHOP_ITEM_PURCHASE_MAX = STORY_SHOP_ITEM_PURCHASE_MAX
export const ACHIEVEMENT_LIMIT = STORY_ACHIEVEMENT_LIMIT
export const ACHIEVEMENT_NAME_MAX = STORY_ACHIEVEMENT_NAME_MAX
export const ACHIEVEMENT_DESCRIPTION_MAX = STORY_ACHIEVEMENT_DESCRIPTION_MAX
export const REWARD_TITLE_MAX = STORY_REWARD_TITLE_MAX
export const PERSONALITY_NAME_MAX = STORY_PERSONALITY_NAME_MAX
export const PERSONALITY_DESCRIPTION_MAX = STORY_PERSONALITY_DESCRIPTION_MAX

export const SHOP_NO_CURRENCY_NOTE = '没有选择货币时，购买只是模拟：价格仅作展示，不会扣除任何数值。'

export const EMPTY_SHOP: StoryShop = { enabled: false, currencyVariableId: null, items: [] }

/** A picture (URL / root path / data URL) rather than an emoji. */
export function isImageIcon(value: string | null | undefined): boolean {
  const icon = value?.trim()
  return !!icon && /^(https?:\/\/|data:image\/|blob:|\/)/.test(icon)
}

/** Same rules the server enforces for variable names, surfaced before the PATCH. */
export function variableNameProblem(variables: readonly StoryVariable[]): string | null {
  const names = new Set<string>()
  for (const variable of variables) {
    const name = variable.name.trim()
    if (!name) return '变量名称不能为空'
    if (name.length > STORY_VARIABLE_NAME_MAX) return `变量名称不能超过 ${STORY_VARIABLE_NAME_MAX} 个字`
    if (names.has(name)) return `变量「${name}」重名`
    names.add(name)
  }
  return null
}

/** Inline, non-blocking warning: the engine clamps the start to the cap anyway. */
export function variableMaxWarning(variable: StoryVariable): string | null {
  if (variable.type !== 'number' || typeof variable.max !== 'number' || !Number.isFinite(variable.max)) return null
  if (typeof variable.initial !== 'number' || !Number.isFinite(variable.initial) || variable.initial <= variable.max) return null
  return `初始值 ${variable.initial} 高于上限 ${variable.max}，开局会被压到上限。`
}

/** Switching to a switch drops the (number-only) cap; switching back starts from 0. */
export function setVariableType(variable: StoryVariable, type: StoryVariableType): StoryVariable {
  if (variable.type === type) return variable
  const base = {
    id: variable.id,
    name: variable.name,
    ...(variable.icon ? { icon: variable.icon } : {}),
    ...(variable.showInHud === true ? { showInHud: true } : {}),
    ...(variable.scope === 'permanent' ? { scope: 'permanent' as const } : {}),
  }
  return type === 'boolean'
    ? { ...base, type: 'boolean', initial: false }
    : { ...base, type: 'number', initial: 0 }
}

function sanitizeEffect(effect: StoryEffect): StoryEffect {
  const value: StoryValue = typeof effect.value === 'boolean' ? effect.value : Number.isFinite(effect.value) ? effect.value : 0
  return { variableId: effect.variableId, op: effect.op === 'add' ? 'add' : 'set', value }
}

/**
 * What actually goes to the server: presentation extras are only written when set, so a plain
 * variable keeps its old shape and old works never grow keys just by being saved.
 */
export function sanitizeVariable(variable: StoryVariable): StoryVariable {
  const name = variable.name.trim().slice(0, STORY_VARIABLE_NAME_MAX)
  const icon = typeof variable.icon === 'string' ? variable.icon.trim().slice(0, STORY_ICON_MAX) : ''
  const extras = {
    ...(icon ? { icon } : {}),
    ...(variable.showInHud === true ? { showInHud: true } : {}),
    ...(variable.scope === 'permanent' ? { scope: 'permanent' as const } : {}),
  }
  if (variable.type === 'boolean') {
    return { id: variable.id, name, type: 'boolean', initial: variable.initial === true, ...extras }
  }
  const initial = typeof variable.initial === 'number' && Number.isFinite(variable.initial) ? variable.initial : 0
  const max = typeof variable.max === 'number' && Number.isFinite(variable.max) ? variable.max : null
  return { id: variable.id, name, type: 'number', initial, ...(max !== null ? { max } : {}), ...extras }
}

export function sanitizeVariables(variables: readonly StoryVariable[]): StoryVariable[] {
  return variables.slice(0, STORY_VARIABLE_LIMIT).map(sanitizeVariable)
}

const roundPrice = (price: number) => Math.round(Math.min(SHOP_PRICE_MAX, Math.max(0, Number.isFinite(price) ? price : 0)) * 100) / 100
const clampLimit = (limit: number) => Math.min(SHOP_ITEM_PURCHASE_MAX, Math.max(0, Math.round(Number.isFinite(limit) ? limit : 1)))

/** A title or frame picture the viewer keeps; `undefined` when it gives nothing, so the key is left out. */
export function sanitizeReward(reward: StoryReward | null | undefined): StoryReward | undefined {
  const title = typeof reward?.title === 'string' ? reward.title.trim().slice(0, REWARD_TITLE_MAX) : ''
  const rawFrame = typeof reward?.frameUrl === 'string' ? reward.frameUrl.trim() : ''
  const frameUrl = rawFrame && rawFrame.length <= STORY_ICON_MAX ? rawFrame : null
  return title || frameUrl ? { title, frameUrl } : undefined
}

export function sanitizeShopItem(item: StoryShopItem): StoryShopItem {
  const icon = typeof item.icon === 'string' ? item.icon.trim().slice(0, STORY_ICON_MAX) : ''
  const reward = sanitizeReward(item.reward)
  return {
    id: item.id,
    name: item.name.trim().slice(0, SHOP_ITEM_NAME_MAX),
    icon: icon || null,
    description: item.description.trim().slice(0, SHOP_ITEM_DESCRIPTION_MAX),
    price: roundPrice(item.price),
    limit: clampLimit(item.limit),
    effects: item.effects.map(sanitizeEffect),
    ...(reward ? { reward } : {}),
  }
}

export function sanitizeShop(shop: StoryShop): StoryShop {
  const items: StoryShopItem[] = []
  const ids = new Set<string>()
  for (const item of shop.items) {
    if (ids.has(item.id)) continue
    ids.add(item.id)
    items.push(sanitizeShopItem(item))
    if (items.length >= SHOP_ITEM_LIMIT) break
  }
  return { enabled: shop.enabled === true, currencyVariableId: shop.currencyVariableId || null, items }
}

/** Fresh arrays so the draft never aliases the stored config. */
export function normalizeShopDraft(shop: StoryShop | undefined): StoryShop {
  return {
    enabled: shop?.enabled === true,
    currencyVariableId: shop?.currencyVariableId ?? null,
    items: (shop?.items ?? []).map((item) => ({
      ...item,
      effects: item.effects.map((effect) => ({ ...effect })),
      ...(item.reward ? { reward: { ...item.reward } } : {}),
    })),
  }
}

export function shopItemNameProblem(shop: StoryShop): string | null {
  return shop.items.some((item) => !item.name.trim()) ? '每件商品都需要名称' : null
}

/** `shop_` + up to 8 client-generated alphanumerics: matches the server id pattern. */
export function shopItemId(random: string): string {
  return `shop_${random.replace(/[^A-Za-z0-9]/g, '').slice(0, 8) || '00000000'}`
}

/** Returns the same array when the move would fall outside the list. */
export function moveShopItem(items: readonly StoryShopItem[], index: number, delta: number): StoryShopItem[] {
  const target = index + delta
  if (index < 0 || index >= items.length || target < 0 || target >= items.length) return items as StoryShopItem[]
  const next = [...items]
  const [item] = next.splice(index, 1)
  next.splice(target, 0, item)
  return next
}

export function newUnlockCondition(variables: readonly StoryVariable[]): StoryCondition[] {
  const first = variables[0]
  if (!first) return []
  return first.type === 'boolean'
    ? [{ variableId: first.id, op: '==', value: true }]
    : [{ variableId: first.id, op: '>=', value: 1 }]
}

export function newOptionUnlock(variables: readonly StoryVariable[]): StoryOptionUnlock | null {
  const conditions = newUnlockCondition(variables)
  return conditions.length ? { mode: 'locked', match: 'all', conditions, shopItemId: null } : null
}

/** Only a locked card can send the viewer shopping, so hidden drops the link. */
export function setUnlockMode(unlock: StoryOptionUnlock, mode: StoryUnlockMode): StoryOptionUnlock {
  return { ...unlock, mode, shopItemId: mode === 'locked' ? unlock.shopItemId : null }
}

/** Writing `unlock: undefined` would keep the key; clearing must remove it entirely. */
export function withOptionUnlock(option: StoryChoiceOption, unlock: StoryOptionUnlock | null): StoryChoiceOption {
  if (unlock) return { ...option, unlock }
  const next: StoryChoiceOption = { ...option }
  delete next.unlock
  return next
}

export function everyOptionGated(options: readonly Pick<StoryChoiceOption, 'unlock'>[]): boolean {
  return options.length > 0 && options.every((option) => !!option.unlock)
}

/* --- achievements ------------------------------------------------------ */

/** Same pattern the server accepts for variable / shop / achievement ids. */
const STORY_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/
export const isStoryId = (value: string): boolean => STORY_ID_PATTERN.test(value)

const trimIcon = (value: string | null | undefined): string | null => {
  const icon = typeof value === 'string' ? value.trim() : ''
  return icon && icon.length <= STORY_ICON_MAX ? icon : null
}

/** An ending / segment condition needs both ids; a value condition needs a valid variable id. */
export function sanitizeAchievementCondition(condition: StoryAchievementCondition): StoryAchievementCondition | null {
  switch (condition.type) {
    case 'ending':
    case 'segment': {
      const projectId = condition.projectId.trim()
      const nodeId = condition.nodeId.trim()
      return projectId && nodeId ? { type: condition.type, projectId, nodeId } : null
    }
    case 'value': {
      if (!isStoryId(condition.variableId)) return null
      const op = STORY_COMPARE_OPS.includes(condition.op) ? condition.op : '>='
      const value = typeof condition.value === 'boolean' ? condition.value : Number.isFinite(condition.value) ? condition.value : 0
      return { type: 'value', variableId: condition.variableId, op, value }
    }
    case 'all_endings':
    case 'all_achievements':
      return { type: condition.type }
    default:
      return null
  }
}

/** Exactly the shape the server stores: trimmed, capped, and with an always-present reward. */
export function sanitizeAchievement(achievement: StoryAchievement): StoryAchievement | null {
  if (!isStoryId(achievement.id)) return null
  const name = achievement.name.trim().slice(0, ACHIEVEMENT_NAME_MAX)
  const condition = sanitizeAchievementCondition(achievement.condition)
  if (!name || !condition) return null
  return {
    id: achievement.id,
    name,
    description: achievement.description.trim().slice(0, ACHIEVEMENT_DESCRIPTION_MAX),
    icon: trimIcon(achievement.icon),
    condition,
    reward: sanitizeReward(achievement.reward) ?? { title: '', frameUrl: null },
  }
}

export function sanitizeAchievements(achievements: readonly StoryAchievement[]): StoryAchievement[] {
  const seen = new Set<string>()
  const list: StoryAchievement[] = []
  for (const entry of achievements) {
    const clean = sanitizeAchievement(entry)
    if (!clean || seen.has(clean.id)) continue
    seen.add(clean.id)
    list.push(clean)
    if (list.length >= ACHIEVEMENT_LIMIT) break
  }
  return list
}

/** Blocks the save before a half-finished card would be silently dropped by the server. */
export function achievementSaveProblem(achievements: readonly StoryAchievement[]): string | null {
  if (achievements.length > ACHIEVEMENT_LIMIT) return `成就最多 ${ACHIEVEMENT_LIMIT} 个`
  for (const achievement of achievements) {
    if (!achievement.name.trim()) return '每个成就都需要名称'
    const condition = achievement.condition
    if (condition.type === 'value' && !isStoryId(condition.variableId)) return `成就「${achievement.name.trim()}」还没有选择数值`
    if ((condition.type === 'ending' || condition.type === 'segment') && (!condition.projectId || !condition.nodeId)) {
      return `成就「${achievement.name.trim()}」还没有选择${condition.type === 'ending' ? '结局' : '片段'}`
    }
    if (!sanitizeAchievement(achievement)) return `成就「${achievement.name.trim()}」还缺少有效的达成条件`
  }
  return null
}

/** Fresh copies so the draft never aliases the stored config. */
export function normalizeAchievementsDraft(achievements: readonly StoryAchievement[] | undefined): StoryAchievement[] {
  return (achievements ?? []).map((item) => ({
    ...item,
    condition: { ...item.condition },
    reward: { ...item.reward },
  }))
}

export function moveAchievement(items: readonly StoryAchievement[], index: number, delta: number): StoryAchievement[] {
  const target = index + delta
  if (index < 0 || index >= items.length || target < 0 || target >= items.length) return items as StoryAchievement[]
  const next = [...items]
  const [item] = next.splice(index, 1)
  next.splice(target, 0, item)
  return next
}

/** `ach_` + up to 8 client-generated alphanumerics: matches the server id pattern. */
export function achievementId(random: string): string {
  return `ach_${random.replace(/[^A-Za-z0-9]/g, '').slice(0, 8) || '00000000'}`
}

/** A new card starts on the first ending (or segment) so it is already valid. */
export function defaultAchievementCondition(places: StoryPlaces): StoryAchievementCondition {
  const ending = places.endings[0]
  if (ending) return { type: 'ending', projectId: ending.projectId, nodeId: ending.nodeId }
  const segment = places.segments[0]
  if (segment) return { type: 'segment', projectId: segment.projectId, nodeId: segment.nodeId }
  return { type: 'all_endings' }
}

export function newAchievement(id: string, name: string, places: StoryPlaces): StoryAchievement {
  return { id, name, description: '', icon: null, condition: defaultAchievementCondition(places), reward: { title: '', frameUrl: null } }
}

export const ACHIEVEMENT_CONDITION_LABELS: Record<StoryAchievementConditionType, string> = {
  ending: '到达结局',
  segment: '到达片段',
  value: '数值达到',
  all_endings: '集齐全部结局',
  all_achievements: '完成全部其他成就',
}

type ValueAchievementCondition = Extract<StoryAchievementCondition, { type: 'value' }>

/** Switching the kind keeps a usable sub-condition; a missing place reads as an empty one the editor asks to fill. */
export function setAchievementConditionType(
  condition: StoryAchievementCondition,
  type: StoryAchievementConditionType,
  places: StoryPlaces,
  variables: readonly StoryVariable[],
): StoryAchievementCondition {
  if (condition.type === type) return condition
  if (type === 'ending') {
    const place = places.endings[0]
    return place ? { type, projectId: place.projectId, nodeId: place.nodeId } : { type, projectId: '', nodeId: '' }
  }
  if (type === 'segment') {
    const place = places.segments[0]
    return place ? { type, projectId: place.projectId, nodeId: place.nodeId } : { type, projectId: '', nodeId: '' }
  }
  if (type === 'value') {
    if (condition.type === 'value') return condition
    const first = variables[0]
    return first
      ? { type, variableId: first.id, op: first.type === 'boolean' ? '==' : '>=', value: first.type === 'boolean' ? true : 1 }
      : { type, variableId: '', op: '>=', value: 1 }
  }
  return { type }
}

/** Picking another variable resets the comparison so a number never keeps a 是/否 target. */
export function setAchievementValueVariable(condition: ValueAchievementCondition, variable: StoryVariable | undefined): ValueAchievementCondition {
  if (!variable) return { ...condition, variableId: '' }
  if (variable.type === 'boolean') {
    return { type: 'value', variableId: variable.id, op: condition.op === '!=' ? '!=' : '==', value: condition.value === true }
  }
  const op = condition.op === '==' || condition.op === '!=' ? '>=' : condition.op
  const value = typeof condition.value === 'number' && Number.isFinite(condition.value) ? condition.value : 1
  return { type: 'value', variableId: variable.id, op, value }
}

/** The place select keeps an unknown stored value visible instead of silently switching the card. */
export function placeConditionOf(kind: 'ending' | 'segment', projectId: string, nodeId: string): StoryAchievementCondition {
  return { type: kind, projectId, nodeId }
}

/* --- personality test -------------------------------------------------- */

export function normalizePersonalityDraft(personality: StoryPersonality | undefined): StoryPersonality {
  const stored = personality?.results ?? {}
  const results: Record<string, StoryPersonalityResult> = {}
  for (const type of STORY_PERSONALITY_TYPES) {
    const entry = stored[type]
    if (entry) results[type] = { name: entry.name ?? '', description: entry.description ?? '', imageUrl: entry.imageUrl ?? null }
  }
  return { enabled: personality?.enabled === true, results }
}

/** Only the sixteen known types survive; a type the creator never touched is left out so it keeps following the defaults. */
export function sanitizePersonality(personality: StoryPersonality | undefined): StoryPersonality {
  const stored = personality?.results ?? {}
  const results: Record<string, StoryPersonalityResult> = {}
  for (const type of STORY_PERSONALITY_TYPES) {
    const entry = stored[type]
    if (!entry) continue
    const name = typeof entry.name === 'string' ? entry.name.trim().slice(0, PERSONALITY_NAME_MAX) : ''
    const description = typeof entry.description === 'string' ? entry.description.trim().slice(0, PERSONALITY_DESCRIPTION_MAX) : ''
    const imageUrl = trimIcon(entry.imageUrl)
    if (name || description || imageUrl) results[type] = { name, description, imageUrl }
  }
  return { enabled: personality?.enabled === true, results }
}

export function personalityEntryOf(personality: StoryPersonality | undefined, type: string): StoryPersonalityResult {
  const entry = personality?.results?.[type]
  return { name: entry?.name ?? '', description: entry?.description ?? '', imageUrl: entry?.imageUrl ?? null }
}

/** An entry that becomes fully empty is removed, so the card falls back to the built-in copy. */
export function withPersonalityEntry(personality: StoryPersonality, type: string, entry: StoryPersonalityResult): StoryPersonality {
  const results = { ...personality.results }
  if (entry.name.trim() || entry.description.trim() || entry.imageUrl) results[type] = entry
  else delete results[type]
  return { ...personality, results }
}

export function restorePersonalityEntry(personality: StoryPersonality, type: string): StoryPersonality {
  const results = { ...personality.results }
  delete results[type]
  return { ...personality, results }
}

export function restoreAllPersonalityEntries(personality: StoryPersonality): StoryPersonality {
  return { ...personality, results: {} }
}

export const personalityHasCustomCopy = (personality: StoryPersonality | undefined): boolean =>
  Object.keys(personality?.results ?? {}).length > 0

/* --- map --------------------------------------------------------------- */

export function normalizeMapDraft(map: StoryMapConfig | undefined): StoryMapConfig {
  return { enabled: map?.enabled === true }
}

export const sanitizeMap = normalizeMapDraft

/** Save points among the given chapters; an old config with no map still counts them for the warning. */
export function savePointCount(chapters: readonly { nodes: readonly { kind: string; savePoint?: unknown }[] }[]): number {
  return chapters.reduce((total, chapter) => total + chapter.nodes.filter((node) => node.kind === 'scene' && !!node.savePoint).length, 0)
}

/* --- playback speed ---------------------------------------------------- */

/** The draft the 倍速 tab edits: always starts at 1x, canonical order, no unknown speeds. */
export function normalizePlaybackDraft(playback: StoryPlaybackConfig | undefined): StoryPlaybackConfig {
  return { speeds: playbackSpeeds({ speeds: Array.isArray(playback?.speeds) ? playback.speeds : [] }) }
}

export const sanitizePlayback = normalizePlaybackDraft

/** 1x is the baseline every work keeps, so it can never be toggled off. */
export function togglePlaybackSpeed(playback: StoryPlaybackConfig, speed: StoryPlaybackSpeed): StoryPlaybackConfig {
  const current = normalizePlaybackDraft(playback).speeds
  if (speed === 1) return { speeds: current }
  const next = current.includes(speed) ? current.filter((entry) => entry !== speed) : [...current, speed]
  return { speeds: playbackSpeeds({ speeds: next }) }
}

/** Tab badge: only the extra speeds, so a work on plain 1x stays unlabelled. */
export const extraPlaybackSpeedCount = (playback: StoryPlaybackConfig | undefined): number =>
  normalizePlaybackDraft(playback).speeds.length - 1

/* --- personality option tags ------------------------------------------- */

/**
 * One click toggles a letter: picking one side of a pair drops the other, clicking the selected
 * letter clears it. Letters are stored in the canonical E I S N T F J P order.
 */
export function togglePersonalityTag(tags: readonly StoryPersonalityTag[] | undefined, tag: StoryPersonalityTag): StoryPersonalityTag[] {
  const current = tags ?? []
  if (current.includes(tag)) return current.filter((item) => item !== tag)
  const axis: readonly StoryPersonalityTag[] = STORY_PERSONALITY_AXES.find((pair) => pair.includes(tag)) ?? []
  const next = [...current.filter((item) => !axis.includes(item)), tag]
  return STORY_PERSONALITY_TAGS.filter((letter) => next.includes(letter))
}

/** Writing `tags: []` would keep the key; clearing must remove it entirely. */
export function withOptionTags(option: StoryChoiceOption, tags: readonly StoryPersonalityTag[]): StoryChoiceOption {
  if (tags.length) return { ...option, tags: [...tags] }
  const next: StoryChoiceOption = { ...option }
  delete next.tags
  return next
}
