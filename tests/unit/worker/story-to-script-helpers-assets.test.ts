import { describe, expect, it, vi } from 'vitest'
import { ASSET_FRAMEOS_METADATA_KEY } from '@/lib/novel-promotion/asset-frameos-metadata'
import {
  persistAnalyzedLocations,
  persistAnalyzedProps,
} from '@/lib/workers/handlers/story-to-script-helpers'

describe('story-to-script asset persistence helpers', () => {
  it('preserves FrameOS metadata for locations and props in image slot availableSlots', async () => {
    const createMany = vi.fn(async () => ({ count: 1 }))
    const db = {
      novelPromotionLocation: {
        create: vi.fn()
          .mockResolvedValueOnce({ id: 'loc-1', name: 'workshop_day' })
          .mockResolvedValueOnce({ id: 'prop-1', name: 'brass key' }),
      },
      locationImage: { createMany },
    } as never

    await persistAnalyzedLocations({
      projectInternalId: 'np-project-1',
      existingNames: new Set(),
      db,
      analyzedLocations: [
        {
          environment_id: 'environment_001',
          name: 'workshop_day',
          int_ext: 'INT',
          summary: 'Workshop day.',
          description: 'Compact workshop.',
          background: 'Primary production workspace.',
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
              prompt: 'Default workshop plate.',
              coverage_scenes: ['scene_1'],
              coverage_episodes: ['episode_1'],
            },
          ],
          descriptions: ['Compact workshop.'],
        },
      ],
    })

    await persistAnalyzedProps({
      projectInternalId: 'np-project-1',
      existingNames: new Set(),
      db,
      analyzedProps: [
        {
          item_id: 'item_001',
          name: 'brass key',
          item_type: 'tool',
          summary: 'Workshop key.',
          description: 'Small brass key.',
          background: 'Calibration tool.',
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
        },
      ],
    })

    const createManyCalls = createMany.mock.calls as unknown as Array<[{
      data: Array<{ availableSlots: string }>
    }]>
    const locationAvailableSlots = createManyCalls[0]?.[0].data[0]?.availableSlots
    const propAvailableSlots = createManyCalls[1]?.[0].data[0]?.availableSlots
    if (!locationAvailableSlots || !propAvailableSlots) {
      throw new Error('expected location and prop image slot calls')
    }
    const locationSlots = JSON.parse(locationAvailableSlots) as Record<string, unknown>
    const propSlots = JSON.parse(propAvailableSlots) as Record<string, unknown>

    expect(locationSlots[ASSET_FRAMEOS_METADATA_KEY]).toEqual(expect.objectContaining({
      asset_kind: 'environment',
      environment_id: 'environment_001',
      int_ext: 'INT',
      entrance: 'rear doorway',
      variants: [expect.objectContaining({ variant_id: 'variant_1' })],
    }))
    expect(propSlots[ASSET_FRAMEOS_METADATA_KEY]).toEqual(expect.objectContaining({
      asset_kind: 'item',
      item_id: 'item_001',
      item_type: 'tool',
      significance: 'recurring precision prop',
      variants: [expect.objectContaining({ variant_id: 'variant_1' })],
    }))
  })
})
