import { describe, expect, it } from 'vitest'
import { calcImage, calcVideo, calcVideoByDuration } from '@/lib/billing/cost'
import { listBuiltinCapabilityCatalog } from '@/lib/model-capabilities/catalog'
import { listBuiltinPricingCatalog } from '@/lib/model-pricing/catalog'
import { listHuimengiCatalogModels } from '@/lib/providers/huimengi/catalog'

describe('HuiMeng catalog pricing', () => {
  it('publishes one capability and one pricing entry for every catalog model', () => {
    const models = listHuimengiCatalogModels()
    const capabilities = listBuiltinCapabilityCatalog().filter((entry) => entry.provider === 'huimengi')
    const pricing = listBuiltinPricingCatalog().filter((entry) => entry.provider === 'huimengi')

    expect(models).toHaveLength(11)
    expect(capabilities).toHaveLength(models.length)
    expect(pricing).toHaveLength(models.length)
    for (const model of models) {
      expect(capabilities.some((entry) => entry.modelId === model.modelId && entry.modelType === model.modality)).toBe(true)
      expect(pricing.some((entry) => entry.modelId === model.modelId)).toBe(true)
    }
  })

  it('prices flat and resolution-tiered images', () => {
    expect(calcImage('huimengi::seedream-5.0-pro', 1, { resolution: '1K' })).toBeCloseTo(0.3, 8)
    expect(calcImage('huimengi::seedream-5.0-pro', 2, { resolution: '2K' })).toBeCloseTo(1.2, 8)
    expect(calcImage('huimengi::seedream-5.0-lite', 1)).toBeCloseTo(0.22, 8)
    expect(calcImage('huimengi::qwen-image-3.0-pro', 1, { resolution: '2k' })).toBeCloseTo(0.5, 8)
    expect(calcImage('huimengi::nb-2.1', 3)).toBeCloseTo(0.36, 8)
  })

  it('scales per-second video price from a five second base', () => {
    expect(calcVideo('huimengi::wan3.0-video', '720p', 1, {
      resolution: '720p', duration: 5, generationMode: 'normal',
    })).toBeCloseTo(1.8, 8)
    expect(calcVideo('huimengi::wan3.0-video', '720p', 1, {
      resolution: '720p', duration: 10, generationMode: 'normal',
    })).toBeCloseTo(3.6, 8)
    expect(calcVideoByDuration('huimengi::happyhorse-1.1', 10, '1080p', 1, { resolution: '1080p' }))
      .toBeCloseTo(5.4, 8)
  })

  it('prices Seedance 1.5 with and without generated audio', () => {
    expect(calcVideo('huimengi::seedance-1.5-pro', '1080p', 1, {
      resolution: '1080p', duration: 5, generationMode: 'normal', generateAudio: true,
    })).toBeCloseTo(3.9, 8)
    expect(calcVideo('huimengi::seedance-1.5-pro', '1080p', 1, {
      resolution: '1080p', duration: 5, generationMode: 'normal', generateAudio: false,
    })).toBeCloseTo(1.95, 8)
  })
})
