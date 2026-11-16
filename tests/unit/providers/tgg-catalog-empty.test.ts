import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { fixedPlatformModels } from '@/lib/platform-services/config'
import {
  getTggModelDefinition,
  listTggCatalogModels,
  listTggSelectableModels,
} from '@/lib/providers/tgg/catalog'

// Safe default before the vendor key/price sheet lands: the three TGG data
// files ship empty, so nothing TGG-related may become selectable or routable.
describe('tgg empty data files', () => {
  it('ships empty capability, pricing and profile catalogs', () => {
    const root = process.cwd()
    expect(JSON.parse(fs.readFileSync(path.join(root, 'standards/capabilities/tgg.catalog.json'), 'utf8'))).toEqual([])
    expect(JSON.parse(fs.readFileSync(path.join(root, 'standards/pricing/tgg.pricing.json'), 'utf8'))).toEqual([])
    expect(JSON.parse(fs.readFileSync(path.join(root, 'src/lib/providers/tgg/model-profiles.json'), 'utf8'))).toEqual({})
  })

  it('exposes no TGG models to discovery, selection or the fixed platform list', () => {
    expect(listTggCatalogModels()).toEqual([])
    expect(listTggSelectableModels()).toEqual([])
    expect(fixedPlatformModels().some((model) => model.provider === 'tgg')).toBe(false)
    expect(() => getTggModelDefinition('tgg-fixture-video')).toThrow('MODEL_NOT_REGISTERED: tgg/video/tgg-fixture-video')
  })
})
