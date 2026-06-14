import { describe, expect, it } from 'vitest'
import {
  ASSET_FRAMEOS_METADATA_KEY,
  buildEnvironmentFrameOSMetadata,
  buildItemFrameOSMetadata,
} from '@/lib/novel-promotion/asset-frameos-metadata'
import {
  parseLocationAvailableSlots,
  readFrameOSAssetMetadataFromAvailableSlots,
  stringifyLocationAvailableSlotsWithFrameOSMetadata,
} from '@/lib/location-available-slots'

describe('asset FrameOS metadata', () => {
  it('stores environment metadata alongside available slots without exposing it as a slot', () => {
    const metadata = buildEnvironmentFrameOSMetadata({
      environment_id: 'environment_001',
      name: 'workshop_day',
      int_ext: 'INT',
      background: 'Primary workshop space.',
      entrance: 'rear doorway',
      mood: 'focused',
      base_ambience: 'soft daylight',
      coverage_scenes: ['scene_1'],
      coverage_episodes: ['episode_1'],
      prompt: 'Wide workshop plate.',
      variants: [
        {
          variant_id: 'variant_1',
          label: 'day default',
          variant_type: 'default',
          prompt: 'Default daytime workshop.',
          coverage_scenes: ['scene_1'],
          coverage_episodes: ['episode_1'],
        },
      ],
      design_image: null,
    })
    const raw = stringifyLocationAvailableSlotsWithFrameOSMetadata(['left side'], metadata)
    const parsed = JSON.parse(raw) as Record<string, unknown>

    expect(parsed[ASSET_FRAMEOS_METADATA_KEY]).toEqual(metadata)
    expect(parseLocationAvailableSlots(raw)).toEqual(['left side'])
    expect(readFrameOSAssetMetadataFromAvailableSlots(raw)).toEqual(metadata)
  })

  it('builds item metadata with variants and coverage', () => {
    const metadata = buildItemFrameOSMetadata({
      item_id: 'item_001',
      name: 'brass key',
      item_type: 'tool',
      background: 'Workshop calibration tool.',
      significance: 'recurring precision prop',
      coverage_scenes: ['scene_1'],
      coverage_episodes: ['episode_1'],
      prompt: 'Standalone brass key.',
      variants: [
        {
          variant_id: 'variant_1',
          label: 'default',
          variant_type: 'default',
          prompt: 'Default brass key.',
          coverage_scenes: ['scene_1'],
          coverage_episodes: ['episode_1'],
        },
      ],
    })

    expect(metadata).toEqual(expect.objectContaining({
      asset_kind: 'item',
      item_id: 'item_001',
      item_type: 'tool',
      significance: 'recurring precision prop',
      coverage_scenes: ['scene_1'],
      coverage_episodes: ['episode_1'],
      variants: [expect.objectContaining({ variant_id: 'variant_1' })],
    }))
  })
})
