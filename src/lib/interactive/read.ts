import {
  STORY_COMPARE_OPS,
  type StoryCompareOp,
  type StoryCondition,
  type StoryEffect,
  type StoryValue,
} from './types'

export const record = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
export const text = (value: unknown) => (typeof value === 'string' ? value : '')
export const id = (value: unknown) => (typeof value === 'string' && value ? value : null)
export const storyValue = (value: unknown): StoryValue => (typeof value === 'boolean' ? value : Number.isFinite(value) ? value as number : 0)

/** A finite number inside [min, max], otherwise the fallback. */
export function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

export function readStoryEffects(raw: unknown): StoryEffect[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((item) => {
    const effect = record(item)
    const variableId = id(effect.variableId)
    if (!variableId) return []
    return [{ variableId, op: effect.op === 'add' ? 'add' : 'set', value: storyValue(effect.value) } satisfies StoryEffect]
  })
}

export function readStoryConditions(raw: unknown): StoryCondition[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((item) => {
    const condition = record(item)
    const variableId = id(condition.variableId)
    if (!variableId) return []
    const op = STORY_COMPARE_OPS.includes(condition.op as StoryCompareOp) ? condition.op as StoryCompareOp : '=='
    return [{ variableId, op, value: storyValue(condition.value) }]
  })
}
