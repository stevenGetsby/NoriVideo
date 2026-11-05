import { describe, expect, it } from 'vitest'
import { calcImage } from '@/lib/billing/cost'
import { findBuiltinPricingCatalogEntry } from '@/lib/model-pricing/catalog'

describe('OpenLux image pricing', () => {
  it('prices the OpenLux image endpoints so usage rows settle', () => {
    expect(calcImage('openlux::gpt-image-2.5-flare', 1)).toBeCloseTo(0.03, 8)
    expect(calcImage('openlux::gpt-image-2.5-sunburst', 1)).toBeCloseTo(0.5, 8)
    expect(calcImage('openlux::gpt-image-2.5-sunburst', 4)).toBeCloseTo(2, 8)
  })

  it('uses the higher existing retail tier for each upstream model', () => {
    // Internal cost mapping only: these are the platform's existing retail
    // tiers, not OpenLux upstream list prices. Flare backs both mini (0.02)
    // and fast (0.03); sunburst backs standard (0.05) and pro (0.5).
    expect(calcImage('nori::nori-image-mini', 1)).toBeCloseTo(0.02, 8)
    expect(calcImage('nori::nori-image-fast', 1)).toBeCloseTo(0.03, 8)
    expect(calcImage('nori::nori-image', 1)).toBeCloseTo(0.05, 8)
    expect(calcImage('nori::nori-image-pro', 1)).toBeCloseTo(0.5, 8)

    expect(findBuiltinPricingCatalogEntry('image', 'openlux', 'gpt-image-2.5-flare')?.pricing)
      .toMatchObject({ mode: 'flat', flatAmount: 0.03 })
    expect(findBuiltinPricingCatalogEntry('image', 'openlux', 'gpt-image-2.5-sunburst')?.pricing)
      .toMatchObject({ mode: 'flat', flatAmount: 0.5 })
  })
})
