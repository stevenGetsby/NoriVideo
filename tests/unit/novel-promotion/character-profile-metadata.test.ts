import { describe, expect, it } from 'vitest'
import {
  normalizeAssetVariants,
  normalizeCoverageEpisodes,
  normalizeExpectedAppearances,
} from '@/lib/novel-promotion/character-profile-metadata'

describe('character profile metadata normalization', () => {
  it('preserves numeric and textual coverage episode labels', () => {
    expect(normalizeCoverageEpisodes([1, '第2集', '', null, Number.NaN])).toEqual([1, '第2集'])
  })

  it('keeps expected appearance coverage metadata for downstream visual planning', () => {
    expect(normalizeExpectedAppearances([
      {
        id: 1,
        change_reason: '初始形象',
        coverage_episodes: ['第1集'],
      },
      {
        id: 'variant-2',
        change_reason: '换装',
        coverage_episodes: [2, '第3集'],
      },
      {
        coverage_episodes: [],
      },
    ])).toEqual([
      {
        id: 1,
        change_reason: '初始形象',
        coverage_episodes: ['第1集'],
      },
      {
        id: 'variant-2',
        change_reason: '换装',
        coverage_episodes: [2, '第3集'],
      },
    ])
  })

  it('normalizes FrameOS-style character variants', () => {
    expect(normalizeAssetVariants([
      {
        variant_id: 'variant_1',
        label: '初始形象',
        variant_type: 'default',
        prompt: '黑发，深色外套',
        coverage_scenes: ['场次1', ''],
        coverage_episodes: ['第1集'],
        design_image: null,
      },
      {
        design_image: null,
      },
    ])).toEqual([
      {
        variant_id: 'variant_1',
        label: '初始形象',
        variant_type: 'default',
        prompt: '黑发，深色外套',
        coverage_scenes: ['场次1'],
        coverage_episodes: ['第1集'],
      },
    ])
  })
})
