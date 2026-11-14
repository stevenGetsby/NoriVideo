import { visibleOptions } from '@/lib/interactive/engine'
import type { StoryChoiceOption, StoryVariables, StoryVariable } from '@/lib/interactive/types'

export type LockedOptionPress =
  | { kind: 'shop'; itemId: string }
  | { kind: 'hint' }
  | { kind: 'none' }

/**
 * What a tap on a choice card does right now: only a locked card reacts, sending the viewer to the
 * shop item that opens it, or to the 「还没有解锁」 hint when the creator linked none.
 */
export function lockedOptionPress(
  options: readonly StoryChoiceOption[],
  optionId: string,
  vars: StoryVariables,
  variables: StoryVariable[],
): LockedOptionPress {
  const view = visibleOptions(options, vars, variables).find((entry) => entry.option.id === optionId)
  if (!view || !view.locked) return { kind: 'none' }
  return view.shopItemId ? { kind: 'shop', itemId: view.shopItemId } : { kind: 'hint' }
}
