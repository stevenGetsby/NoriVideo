import { describe, expect, it } from 'vitest'
import {
  CHARACTER_APPEARANCE_FRAMEOS_METADATA_KEY,
  buildCharacterAppearanceFrameOSMetadata,
  parseCharacterDescriptionValues,
  readFrameOSAppearanceMetadataFromDescriptions,
  stringifyCharacterDescriptionsWithFrameOSMetadata,
} from '@/lib/novel-promotion/character-appearance-frameos-metadata'

describe('character appearance FrameOS metadata', () => {
  it('stores metadata beside description values while keeping array parsing compatible', () => {
    const metadata = buildCharacterAppearanceFrameOSMetadata({
      appearance: { id: 1, change_reason: 'rain coat variant' },
      appearanceIndex: 1,
      profile: {
        coverage_scenes: ['scene_1'],
        expected_appearances: [
          { id: 1, change_reason: 'rain coat variant', coverage_episodes: ['episode_2'] },
        ],
        variants: [
          {
            variant_id: 1,
            label: 'rain coat variant',
            variant_type: 'costume',
            prompt: 'Same face and goggles, dark rain coat.',
            coverage_scenes: ['alley_rain'],
            coverage_episodes: ['episode_2'],
          },
        ],
      },
    })
    const raw = stringifyCharacterDescriptionsWithFrameOSMetadata(['dark rain coat'], metadata)
    const parsed = JSON.parse(raw) as Record<string, unknown>

    expect(parsed[CHARACTER_APPEARANCE_FRAMEOS_METADATA_KEY]).toEqual(metadata)
    expect(parseCharacterDescriptionValues(raw)).toEqual(['dark rain coat'])
    expect(readFrameOSAppearanceMetadataFromDescriptions(raw)).toEqual(expect.objectContaining({
      appearance_id: 1,
      variant_id: 1,
      variant_type: 'costume',
      prompt: 'Same face and goggles, dark rain coat.',
      coverage_scenes: ['alley_rain'],
      coverage_episodes: ['episode_2'],
    }))
  })

  it('continues to parse legacy description arrays', () => {
    expect(parseCharacterDescriptionValues(JSON.stringify(['primary', 'variant']))).toEqual(['primary', 'variant'])
  })
})
