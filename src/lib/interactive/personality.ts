import {
  STORY_PERSONALITY_AXES,
  STORY_PERSONALITY_TAGS,
  type StoryPersonality,
  type StoryPersonalityTag,
} from './types'

const isTag = (value: unknown): value is StoryPersonalityTag => STORY_PERSONALITY_TAGS.includes(value as StoryPersonalityTag)
const axisIndex = (tag: StoryPersonalityTag) => STORY_PERSONALITY_AXES.findIndex((pair) => pair.includes(tag))

/** Letters an option scores: known letters only, each once, and at most one per pair (the first one wins). */
export function readPersonalityTags(raw: unknown): StoryPersonalityTag[] {
  if (!Array.isArray(raw)) return []
  const picked: StoryPersonalityTag[] = []
  for (const value of raw) {
    if (!isTag(value) || picked.some((tag) => axisIndex(tag) === axisIndex(value))) continue
    picked.push(value)
  }
  return picked
}

/** Letters a viewer has scored so far in one play. */
export type StoryPersonalityCounts = Partial<Record<StoryPersonalityTag, number>>

/** Adds one point per letter; returns the same object when there is nothing to add. */
export function tallyPersonality(counts: StoryPersonalityCounts | undefined, tags: readonly StoryPersonalityTag[] | undefined): StoryPersonalityCounts | undefined {
  if (!tags?.length) return counts
  const next: StoryPersonalityCounts = { ...counts }
  for (const tag of tags) next[tag] = (next[tag] ?? 0) + 1
  return next
}

/** The sixteen types in the usual grid order. */
export const STORY_PERSONALITY_TYPES = [
  'ISTJ', 'ISFJ', 'INFJ', 'INTJ',
  'ISTP', 'ISFP', 'INFP', 'INTP',
  'ESTP', 'ESFP', 'ENFP', 'ENTP',
  'ESTJ', 'ESFJ', 'ENFJ', 'ENTJ',
] as const
export type StoryPersonalityType = (typeof STORY_PERSONALITY_TYPES)[number]

export const isPersonalityType = (value: unknown): value is StoryPersonalityType => STORY_PERSONALITY_TYPES.includes(value as StoryPersonalityType)

/** What a type shows until the creator writes their own name and copy. */
export const STORY_PERSONALITY_DEFAULTS: Record<StoryPersonalityType, { name: string; description: string }> = {
  ISTJ: { name: '物流师', description: '踏实可靠，重视规则与承诺，答应的事一定做到。' },
  ISFJ: { name: '守卫者', description: '温和细心，默默守护着身边的每一个人。' },
  INFJ: { name: '提倡者', description: '安静而坚定，怀着理想去照亮别人。' },
  INTJ: { name: '建筑师', description: '冷静有远见，擅长为目标制定周密的计划。' },
  ISTP: { name: '鉴赏家', description: '沉着务实，遇到问题习惯亲手解决。' },
  ISFP: { name: '探险家', description: '随性而敏感，热爱美好与自由。' },
  INFP: { name: '调停者', description: '内心丰盈，始终忠于自己的价值。' },
  INTP: { name: '逻辑学家', description: '好奇善思，喜欢拆解世界运行的规律。' },
  ESTP: { name: '企业家', description: '敢闯敢拼，享受当下的每一次挑战。' },
  ESFP: { name: '表演者', description: '热情外向，走到哪里都是焦点。' },
  ENFP: { name: '竞选者', description: '点子不断，用热情感染身边的人。' },
  ENTP: { name: '辩论家', description: '机敏好辩，爱挑战常规与权威。' },
  ESTJ: { name: '总经理', description: '果断务实，擅长把事情安排得井井有条。' },
  ESFJ: { name: '执政官', description: '热心周到，乐于照顾和联结大家。' },
  ENFJ: { name: '主人公', description: '有感染力，天生愿意带领大家向前。' },
  ENTJ: { name: '指挥官', description: '自信强势，目标明确，善于统筹全局。' },
}

export interface PersonalityAxisScore {
  left: StoryPersonalityTag
  right: StoryPersonalityTag
  leftCount: number
  rightCount: number
  /** The letter this pair settled on; a tie goes to the left one. */
  pick: StoryPersonalityTag
}

export interface PersonalityOutcome {
  type: StoryPersonalityType
  axes: PersonalityAxisScore[]
}

/** The viewer's type, or null when nothing they chose carried a letter. */
export function personalityOutcome(counts: StoryPersonalityCounts | undefined): PersonalityOutcome | null {
  const total = STORY_PERSONALITY_TAGS.reduce((sum, tag) => sum + (counts?.[tag] ?? 0), 0)
  if (!total) return null
  const axes = STORY_PERSONALITY_AXES.map(([left, right]): PersonalityAxisScore => {
    const leftCount = counts?.[left] ?? 0
    const rightCount = counts?.[right] ?? 0
    return { left, right, leftCount, rightCount, pick: rightCount > leftCount ? right : left }
  })
  // One letter from each pair always spells one of the sixteen types.
  return { type: axes.map((axis) => axis.pick).join('') as StoryPersonalityType, axes }
}

export interface PersonalityView extends PersonalityOutcome {
  name: string
  description: string
  imageUrl: string | null
}

/** A result card for a type: what the creator wrote, with the built-in name and line standing in for an empty entry. */
export function personalityResultFor(personality: StoryPersonality | undefined, type: StoryPersonalityType): Pick<PersonalityView, 'name' | 'description' | 'imageUrl'> {
  const entry = personality?.results[type]
  const fallback = STORY_PERSONALITY_DEFAULTS[type]
  const name = entry?.name.trim() ?? ''
  const description = entry?.description.trim() ?? ''
  const untouched = !name && !description
  return {
    name: name || fallback.name,
    description: untouched ? fallback.description : description,
    imageUrl: entry?.imageUrl ?? null,
  }
}

/** The result card a viewer gets, or null when the test is off or nothing they chose scored a letter. */
export function personalityView(personality: StoryPersonality | undefined, counts: StoryPersonalityCounts | undefined): PersonalityView | null {
  if (!personality?.enabled) return null
  const outcome = personalityOutcome(counts)
  return outcome ? { ...outcome, ...personalityResultFor(personality, outcome.type) } : null
}
