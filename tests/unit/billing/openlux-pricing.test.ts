import { describe, expect, it } from 'vitest'
import { calcImage } from '@/lib/billing/cost'
import { findBuiltinPricingCatalogEntry } from '@/lib/model-pricing/catalog'

describe('OpenLux image pricing', () => {
  it('prices the OpenLux image endpoints so usage rows settle', () => {
    expect(calcImage('openlux::gpt-image-2.5-flare', 1)).toBeCloseTo(0.03, 8)
    expect(calcImage('openlux::gpt-image-2.5-sunburst', 1)).toBeCloseTo(0.5, 8)
    expect(calcImage('openlux::gpt-image-2.5-sunburst', 4)).toBeCloseTo(2, 8)
  })

  it('prices every verified -c variant with its upstream fixed model price', () => {
    for (const modelId of [
      'gpt-image-2.5-flare-c',
      'gpt-image-2.5-sunburst-c',
      'gpt-image-2.6-flare-c',
      'gpt-image-2.6-sunburst-c',
    ]) {
      expect(calcImage(`openlux::${modelId}`, 1)).toBeCloseTo(0.16, 8)
      expect(calcImage(`openlux::${modelId}`, 3)).toBeCloseTo(0.48, 8)
      expect(findBuiltinPricingCatalogEntry('image', 'openlux', modelId)?.pricing)
        .toMatchObject({ mode: 'flat', flatAmount: 0.16 })
    }
  })

  it('fails closed for ratio-priced models without a deterministic per-image price', () => {
    expect(() => calcImage('openlux::gpt-image-2.6-flare', 1)).toThrow('Unknown image model pricing')
    expect(() => calcImage('openlux::gpt-image-2.6-sunburst', 1)).toThrow('Unknown image model pricing')
  })

  it('does not let user custom pricing silently enable an unpriced OpenLux model', () => {
    for (const modelId of ['gpt-image-2.6-flare', 'gpt-image-2.6-sunburst']) {
      expect(() => calcImage(`openlux::${modelId}`, 1, {}, {
        image: { basePrice: 0.01 },
      })).toThrow('Unknown image model pricing')
    }
  })

  it('uses the higher existing retail tier for each upstream model', () => {
    // Internal cost mapping only: these are the platform's existing retail
    // tiers, not OpenLux upstream list prices. Flare backs both mini (0.02)
    // and fast (0.03); sunburst backs standard (0.05) and pro (0.5).
    expect(calcImage('nori::nori-image-mini', 1)).toBeCloseTo(0.02, 8)
    expect(calcImage('nori::nori-image-fast', 1)).toBeCloseTo(0.03, 8)
    expect(calcImage('nori::nori-image', 1)).toBeCloseTo(0.05, 8)
    expect(calcImage('nori::nori-image-pro', 1)).toBeCloseTo(0.5, 8)
    // Newly added 2.6 image tiers have no separate retail override yet, so
    // they resolve through their routed, verified upstream price.
    expect(calcImage('nori::nori-image-2.6', 1)).toBeCloseTo(0.16, 8)
    expect(calcImage('nori::nori-image-2.6-pro', 1)).toBeCloseTo(0.16, 8)

    expect(findBuiltinPricingCatalogEntry('image', 'openlux', 'gpt-image-2.5-flare')?.pricing)
      .toMatchObject({ mode: 'flat', flatAmount: 0.03 })
    expect(findBuiltinPricingCatalogEntry('image', 'openlux', 'gpt-image-2.5-sunburst')?.pricing)
      .toMatchObject({ mode: 'flat', flatAmount: 0.5 })
  })
})
