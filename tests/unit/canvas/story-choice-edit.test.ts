import { describe, expect, it } from 'vitest'
import { STORY_CHOICE_COUNTDOWNS } from '@/lib/interactive/interaction'
import type { StoryChoiceOption } from '@/lib/interactive/types'
import {
  addChoiceOption,
  choiceCountdownOptions,
  choiceOrdinal,
  newChoiceOption,
  removeChoiceOption,
  STANDALONE_CHOICE_MAX_OPTIONS,
} from '@/features/canvas/story/story-choice-edit'

const option = (id: string, label = id): StoryChoiceOption => newChoiceOption(id, label)

describe('choice countdown lists', () => {
  it('offers 不限时 first for the standalone choice', () => {
    expect(choiceCountdownOptions(STORY_CHOICE_COUNTDOWNS, null, { unlimited: true })).toEqual([0, 1, 2, 3, 5, 10])
  })

  it('keeps a legacy countdown selectable', () => {
    expect(choiceCountdownOptions(STORY_CHOICE_COUNTDOWNS, 15, { unlimited: true })).toEqual([0, 1, 2, 3, 5, 10, 15])
    expect(choiceCountdownOptions(STORY_CHOICE_COUNTDOWNS, 30, { unlimited: true })).toEqual([0, 1, 2, 3, 5, 10, 30])
  })

  it('does not duplicate an existing value', () => {
    expect(choiceCountdownOptions(STORY_CHOICE_COUNTDOWNS, 3, { unlimited: true })).toEqual([0, 1, 2, 3, 5, 10])
  })

  it('keeps a mounted choice timed and shows an unusual stored value', () => {
    expect(choiceCountdownOptions(STORY_CHOICE_COUNTDOWNS, null, { unlimited: false })).toEqual([1, 2, 3, 5, 10])
    expect(choiceCountdownOptions(STORY_CHOICE_COUNTDOWNS, 7, { unlimited: false })).toEqual([1, 2, 3, 5, 7, 10])
  })

  it('ignores zero and invalid values', () => {
    expect(choiceCountdownOptions([0, 3, -2, Number.NaN], null, { unlimited: false })).toEqual([3])
    expect(choiceCountdownOptions([], Number.NaN, { unlimited: true })).toEqual([0])
  })
})

describe('choice option editing', () => {
  it('names new options by their position', () => {
    expect(choiceOrdinal(0)).toBe('一')
    expect(choiceOrdinal(5)).toBe('六')
    expect(choiceOrdinal(6)).toBe('7')
    const added = addChoiceOption([option('a'), option('b')], 'opt_new', STANDALONE_CHOICE_MAX_OPTIONS)
    expect(added.map((item) => item.id)).toEqual(['a', 'b', 'opt_new'])
    expect(added[2].label).toBe('选项三')
  })

  it('stops at the option cap and returns the same array', () => {
    const options = [option('a'), option('b'), option('c'), option('d')]
    expect(addChoiceOption(options, 'e', 4)).toBe(options)
    expect(addChoiceOption(options, 'e', 4)).toHaveLength(4)
  })

  it('clears a deleted default option', () => {
    const options = [option('a'), option('b'), option('c')]
    const next = removeChoiceOption(options, 'b', 'b', 1)
    expect(next.options.map((item) => item.id)).toEqual(['a', 'c'])
    expect(next.defaultOptionId).toBeNull()
  })

  it('keeps an untouched default option', () => {
    const options = [option('a'), option('b')]
    expect(removeChoiceOption(options, 'b', 'a', 1)).toEqual({ options: [options[0]], defaultOptionId: 'a' })
  })

  it('refuses to go below the minimum and ignores unknown ids', () => {
    const single = [option('a')]
    expect(removeChoiceOption(single, 'a', null, 1).options).toBe(single)
    const pair = [option('a'), option('b')]
    expect(removeChoiceOption(pair, 'a', null, 2).options).toBe(pair)
    expect(removeChoiceOption(pair, 'gone', null, 1).options).toBe(pair)
  })
})
