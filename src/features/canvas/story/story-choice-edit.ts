import type { StoryChoiceOption } from '@/lib/interactive/types'

/** The standalone choice node keeps its original six-row limit. */
export const STANDALONE_CHOICE_MAX_OPTIONS = 6

const ORDINAL = ['一', '二', '三', '四', '五', '六']

export const choiceOrdinal = (index: number): string => ORDINAL[index] ?? String(index + 1)

/**
 * Countdown values offered by a choice editor: standalone lists 不限时 (0) first, a mounted
 * choice is always timed. A legacy/unusual stored value stays selectable instead of vanishing.
 */
export function choiceCountdownOptions(values: readonly number[], current: number | null, options: { unlimited: boolean }): number[] {
  const list = new Set<number>()
  if (options.unlimited) list.add(0)
  for (const value of values) if (Number.isFinite(value) && value > 0) list.add(value)
  if (current != null && Number.isFinite(current) && current > 0) list.add(current)
  return [...list].sort((a, b) => a - b)
}

export function newChoiceOption(id: string, label: string): StoryChoiceOption {
  return { id, label, effects: [], imageUrl: null, when: 'now', retry: false }
}

/** Appends an option with the next ordinal label; returns the same array once the cap is reached. */
export function addChoiceOption(options: readonly StoryChoiceOption[], id: string, max: number): StoryChoiceOption[] {
  if (options.length >= max) return options as StoryChoiceOption[]
  return [...options, newChoiceOption(id, `选项${choiceOrdinal(options.length)}`)]
}

/** Removes an option; deleting the default option clears `defaultOptionId`. Below the floor nothing changes. */
export function removeChoiceOption(
  options: readonly StoryChoiceOption[],
  optionId: string,
  defaultOptionId: string | null,
  min: number,
): { options: StoryChoiceOption[]; defaultOptionId: string | null } {
  if (options.length <= min || !options.some((option) => option.id === optionId)) {
    return { options: options as StoryChoiceOption[], defaultOptionId }
  }
  return {
    options: options.filter((option) => option.id !== optionId),
    defaultOptionId: defaultOptionId === optionId ? null : defaultOptionId,
  }
}
