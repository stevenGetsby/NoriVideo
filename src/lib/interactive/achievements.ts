import { evaluateCondition, type StoryRun } from './engine'
import type { StoryAchievement, StoryProgram, StoryReward } from './types'

/**
 * What a viewer keeps between plays of one work, in their own browser: the endings and segments they
 * have reached, the achievements they have earned, the shop rewards they bought and what they wear.
 */
export interface StoryProfile {
  /** `projectId:nodeId` of every ending reached. */
  endings: string[]
  /** `projectId:nodeId` of every segment reached. */
  segments: string[]
  achievements: string[]
  /** Shop items whose title or frame the viewer bought. */
  bought: string[]
  /** Cosmetic ids ({@link StoryCosmetic.id}) the viewer wears. */
  equipped: { title: string | null; frame: string | null }
}

const PROFILE_LIST_MAX = 2000

export const emptyProfile = (): StoryProfile => ({ endings: [], segments: [], achievements: [], bought: [], equipped: { title: null, frame: null } })

export const reachKey = (projectId: string, nodeId: string) => `${projectId}:${nodeId}`

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === 'string' && item.length > 0))].slice(0, PROFILE_LIST_MAX) : []
const idOrNull = (value: unknown) => (typeof value === 'string' && value ? value : null)

/** Lenient read of a stored profile: anything malformed falls back to empty. */
export function readProfile(raw: unknown): StoryProfile {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return emptyProfile()
  const data = raw as Record<string, unknown>
  const equipped = typeof data.equipped === 'object' && data.equipped !== null ? data.equipped as Record<string, unknown> : {}
  return {
    endings: strings(data.endings),
    segments: strings(data.segments),
    achievements: strings(data.achievements),
    bought: strings(data.bought),
    equipped: { title: idOrNull(equipped.title), frame: idOrNull(equipped.frame) },
  }
}

const hasReward = (reward: StoryReward) => Boolean(reward.title || reward.frameUrl)

/** Every ending in the story, as reach keys. */
export const endingKeys = (program: StoryProgram): string[] =>
  program.chapters.flatMap((chapter) => chapter.nodes.filter((node) => node.kind === 'ending').map((node) => reachKey(chapter.projectId, node.id)))

function withReached(profile: StoryProfile, run: StoryRun): StoryProfile {
  const endings = new Set(profile.endings)
  const segments = new Set(profile.segments)
  const visit = (kind: string, projectId: string, nodeId: string) => {
    if (kind === 'scene') segments.add(reachKey(projectId, nodeId))
    else if (kind === 'ending') endings.add(reachKey(projectId, nodeId))
  }
  for (const step of run.trail) visit(step.kind, step.projectId, step.nodeId)
  const { stop } = run
  if (stop.kind === 'scene' || stop.kind === 'ending') visit(stop.kind, stop.projectId, stop.node.id)
  if (endings.size === profile.endings.length && segments.size === profile.segments.length) return profile
  return { ...profile, endings: [...endings], segments: [...segments] }
}

function isMet(achievement: StoryAchievement, program: StoryProgram, profile: StoryProfile, run: StoryRun): boolean {
  const { condition } = achievement
  switch (condition.type) {
    case 'ending': return profile.endings.includes(reachKey(condition.projectId, condition.nodeId))
    case 'segment': return profile.segments.includes(reachKey(condition.projectId, condition.nodeId))
    case 'value':
      return evaluateCondition({ variableId: condition.variableId, op: condition.op, value: condition.value }, run.vars, program.variables)
    case 'all_endings': {
      const keys = endingKeys(program)
      return keys.length > 0 && keys.every((key) => profile.endings.includes(key))
    }
    case 'all_achievements': {
      const others = (program.achievements ?? []).filter((item) => item.condition.type !== 'all_achievements')
      return others.length > 0 && others.every((item) => profile.achievements.includes(item.id))
    }
  }
}

/** A reward a viewer just got goes on at once, unless they already wear something in that place. */
function equipIfEmpty(profile: StoryProfile, cosmeticId: string, reward: StoryReward): StoryProfile {
  const wantsTitle = Boolean(reward.title) && !profile.equipped.title
  const wantsFrame = Boolean(reward.frameUrl) && !profile.equipped.frame
  if (!wantsTitle && !wantsFrame) return profile
  return { ...profile, equipped: { title: wantsTitle ? cosmeticId : profile.equipped.title, frame: wantsFrame ? cosmeticId : profile.equipped.frame } }
}

export interface ProfileUpdate {
  profile: StoryProfile
  /** Achievements this call earned, in the order they were earned (for a toast). */
  earned: StoryAchievement[]
}

/**
 * Records what the run has reached and earns every achievement whose condition now holds.
 * Run it after each change to the run; it returns the same profile object when nothing changed.
 * "Finish all achievements" is settled in the same call as the last achievement it waits for.
 */
export function observeRun(program: StoryProgram, profile: StoryProfile, run: StoryRun): ProfileUpdate {
  let next = withReached(profile, run)
  const achievements = program.achievements ?? []
  const earned: StoryAchievement[] = []
  for (let pass = 0; pass <= achievements.length; pass += 1) {
    const fresh = achievements.filter((item) => !next.achievements.includes(item.id) && isMet(item, program, next, run))
    if (!fresh.length) break
    earned.push(...fresh)
    next = fresh.reduce((state, item) => equipIfEmpty({ ...state, achievements: [...state.achievements, item.id] }, `a:${item.id}`, item.reward), next)
  }
  return { profile: next, earned }
}

/** Keeps a bought title or frame for good; ignores items that carry none or were already bought. */
export function recordShopReward(program: StoryProgram, profile: StoryProfile, itemId: string): StoryProfile {
  const item = program.shop?.items.find((entry) => entry.id === itemId)
  if (!item?.reward || !hasReward(item.reward) || profile.bought.includes(itemId)) return profile
  return equipIfEmpty({ ...profile, bought: [...profile.bought, itemId] }, `s:${itemId}`, item.reward)
}

/** A title or frame the viewer owns, whether earned or bought. */
export interface StoryCosmetic {
  id: string
  source: 'achievement' | 'shop'
  /** The achievement or shop item it came from. */
  name: string
  reward: StoryReward
}

export function cosmeticsOf(program: StoryProgram, profile: StoryProfile): StoryCosmetic[] {
  const earned = (program.achievements ?? [])
    .filter((item) => profile.achievements.includes(item.id) && hasReward(item.reward))
    .map((item): StoryCosmetic => ({ id: `a:${item.id}`, source: 'achievement', name: item.name, reward: item.reward }))
  const bought = (program.shop?.items ?? [])
    .filter((item) => item.reward && hasReward(item.reward) && profile.bought.includes(item.id))
    .map((item): StoryCosmetic => ({ id: `s:${item.id}`, source: 'shop', name: item.name, reward: item.reward as StoryReward }))
  return [...earned, ...bought]
}

/** Puts a title or frame on (or takes it off with null); something the viewer does not own, or that has no such part, is ignored. */
export function equipCosmetic(program: StoryProgram, profile: StoryProfile, part: 'title' | 'frame', cosmeticId: string | null): StoryProfile {
  if (cosmeticId === null) return { ...profile, equipped: { ...profile.equipped, [part]: null } }
  const cosmetic = cosmeticsOf(program, profile).find((item) => item.id === cosmeticId)
  const fits = part === 'title' ? Boolean(cosmetic?.reward.title) : Boolean(cosmetic?.reward.frameUrl)
  return cosmetic && fits ? { ...profile, equipped: { ...profile.equipped, [part]: cosmeticId } } : profile
}

/** What the viewer's avatar wears right now. */
export function equippedLook(program: StoryProgram, profile: StoryProfile): { title: string | null; frameUrl: string | null } {
  const owned = cosmeticsOf(program, profile)
  return {
    title: owned.find((item) => item.id === profile.equipped.title)?.reward.title || null,
    frameUrl: owned.find((item) => item.id === profile.equipped.frame)?.reward.frameUrl ?? null,
  }
}

export const achievementProgress = (program: StoryProgram, profile: StoryProfile) => ({
  earned: (program.achievements ?? []).filter((item) => profile.achievements.includes(item.id)).length,
  total: program.achievements?.length ?? 0,
})

/** The achievement that fires on reaching this ending, if the creator made one (the ending's 「设为成就」). */
export const endingAchievementOf = (achievements: readonly StoryAchievement[] | undefined, projectId: string, nodeId: string): StoryAchievement | undefined =>
  achievements?.find((item) => item.condition.type === 'ending' && item.condition.projectId === projectId && item.condition.nodeId === nodeId)

/** Switches 「设为成就」 on an ending: removes its achievement, or adds one named after the ending. */
export function toggleEndingAchievement(
  achievements: readonly StoryAchievement[] | undefined,
  ending: { projectId: string; nodeId: string; title: string },
  createId: () => string,
): StoryAchievement[] {
  const list = achievements ?? []
  const existing = endingAchievementOf(list, ending.projectId, ending.nodeId)
  if (existing) return list.filter((item) => item.id !== existing.id)
  return [...list, {
    id: createId(),
    name: ending.title.trim() || '结局',
    description: '',
    icon: null,
    condition: { type: 'ending', projectId: ending.projectId, nodeId: ending.nodeId },
    reward: { title: '', frameUrl: null },
  }]
}
