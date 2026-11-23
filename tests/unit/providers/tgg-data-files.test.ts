import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { fixedPlatformModels } from '@/lib/platform-services/config'
import {
  getTggModelDefinition,
  listTggSelectableModels,
} from '@/lib/providers/tgg/catalog'

type RecordLike = Record<string, unknown>

function readJson(relative: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(process.cwd(), relative), 'utf8'))
}

describe('tgg data files', () => {
  it('prices every duration of each TGG video capability with a positive tier', () => {
    const capabilities = readJson('standards/capabilities/tgg.catalog.json') as RecordLike[]
    const pricing = readJson('standards/pricing/tgg.pricing.json') as RecordLike[]
    for (const entry of capabilities) {
      const video = (entry.capabilities as RecordLike).video as RecordLike
      const durations = video.durationOptions as number[]
      const priced = pricing.find((item) => (
        item.apiType === 'video' && item.provider === 'tgg' && item.modelId === entry.modelId
      ))
      expect(priced, `${String(entry.modelId)} needs pricing`).toBeDefined()
      const tiers = ((priced as RecordLike).pricing as { tiers: Array<{ when: RecordLike; amount: number }> }).tiers
      for (const seconds of durations) {
        expect(tiers.some((tier) => tier.when.duration === seconds && tier.amount > 0)).toBe(true)
      }
    }
  })

  it('keeps every selectable TGG model backed by verified ratios', () => {
    expect(listTggSelectableModels().every((model) => model.ratios.length > 0)).toBe(true)
  })

  it('lists exactly the verified TGG models in the platform list and rejects unregistered ids', () => {
    const tggKeys = fixedPlatformModels()
      .filter((model) => model.provider === 'tgg')
      .map((model) => model.modelKey)
      .sort()
    expect(tggKeys).toEqual(['tgg::seedance_v2.5_full', 'tgg::vig-S2.5-480-秒'])
    expect(() => getTggModelDefinition('tgg-fixture-video')).toThrow('MODEL_NOT_REGISTERED: tgg/video/tgg-fixture-video')
  })

  it('shares the Seedance 2.5 parameter spec across both TGG relays', () => {
    const capabilities = readJson('standards/capabilities/tgg.catalog.json') as RecordLike[]
    const specs = capabilities.map((entry) => JSON.stringify((entry.capabilities as RecordLike).video))
    expect(new Set(specs).size).toBe(1)
    const [spec] = capabilities.map((entry) => (entry.capabilities as RecordLike).video as RecordLike)
    expect(spec.durationOptions).toEqual(Array.from({ length: 26 }, (_, index) => index + 5))
  })
})
