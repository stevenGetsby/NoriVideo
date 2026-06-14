import { describe, expect, it } from 'vitest'
import {
  CHARACTER_APPEARANCE_FRAMEOS_METADATA_KEY,
  stringifyCharacterDescriptionsWithFrameOSMetadata,
} from '@/lib/novel-promotion/character-appearance-frameos-metadata'
import {
  buildCharacterDescriptionFields,
  readIndexedDescription,
} from '@/lib/assets/description-fields'

describe('character description fields', () => {
  it('reads object-backed descriptions and preserves FrameOS metadata when editing one value', () => {
    const existing = stringifyCharacterDescriptionsWithFrameOSMetadata(
      ['primary look', 'rain coat'],
      {
        appearance_id: 1,
        variant_id: 'variant_1',
        prompt: 'Keep same face and add rain coat.',
      },
    )

    expect(readIndexedDescription({
      descriptions: existing,
      fallbackDescription: 'fallback',
      index: 1,
    })).toBe('rain coat')

    const next = buildCharacterDescriptionFields({
      descriptions: existing,
      fallbackDescription: 'fallback',
      index: 1,
      nextDescription: 'updated rain coat',
    })
    const parsed = JSON.parse(next.descriptions) as Record<string, unknown>

    expect(next.description).toBe('primary look')
    expect(parsed.values).toEqual(['primary look', 'updated rain coat'])
    expect(parsed[CHARACTER_APPEARANCE_FRAMEOS_METADATA_KEY]).toEqual({
      appearance_id: 1,
      variant_id: 'variant_1',
      prompt: 'Keep same face and add rain coat.',
    })
  })
})
