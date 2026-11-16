import { beforeEach, describe, expect, it, vi } from 'vitest'

const catalogState = vi.hoisted(() => ({
  capabilities: [] as Array<Record<string, unknown>>,
  pricing: [] as Array<Record<string, unknown>>,
  profiles: {} as Record<string, unknown>,
}))

vi.mock('@/lib/model-capabilities/catalog', () => ({
  listBuiltinCapabilityCatalog: () => catalogState.capabilities,
  findBuiltinCapabilityCatalogEntry: (modelType: string, provider: string, modelId: string) => (
    catalogState.capabilities.find((entry) => (
      entry.modelType === modelType && entry.provider === provider && entry.modelId === modelId
    )) ?? null
  ),
  findBuiltinCapabilities: (modelType: string, provider: string, modelId: string) => (
    catalogState.capabilities.find((entry) => (
      entry.modelType === modelType && entry.provider === provider && entry.modelId === modelId
    ))?.capabilities
  ),
}))

vi.mock('@/lib/model-pricing/catalog', () => ({
  findBuiltinPricingCatalogEntry: (apiType: string, provider: string, modelId: string) => (
    catalogState.pricing.find((entry) => (
      entry.apiType === apiType && entry.provider === provider && entry.modelId === modelId
    )) ?? null
  ),
  findBuiltinPricingCatalogEntriesByModelId: (apiType: string, modelId: string) => (
    catalogState.pricing.filter((entry) => entry.apiType === apiType && entry.modelId === modelId)
  ),
}))

vi.mock('@/lib/providers/tgg/model-profiles.json', () => ({ default: catalogState.profiles }))

import { calcVideoByDuration } from '@/lib/billing/cost'
import {
  getTggModelDefinition,
  listTggCatalogModels,
  listTggSelectableModels,
} from '@/lib/providers/tgg/catalog'

const FIXTURE_MODEL_ID = 'tgg-fixture-video'

function capabilityEntry(overrides: Record<string, unknown> = {}) {
  return {
    modelType: 'video',
    provider: 'tgg',
    modelId: FIXTURE_MODEL_ID,
    capabilities: {
      video: {
        durationOptions: [5, 10],
        resolutionOptions: ['720p', '1080p'],
        supportGenerateAudio: true,
        firstlastframe: false,
        inputSchema: { image: { max: 2 }, video: { max: 1 }, audio: { max: 1 } },
        ...overrides,
      },
    },
  }
}

function pricingEntry(tiers: Array<{ when: Record<string, unknown>; amount: number }>) {
  return {
    apiType: 'video',
    provider: 'tgg',
    modelId: FIXTURE_MODEL_ID,
    pricing: { mode: 'capability', tiers },
  }
}

function verifiedTiers() {
  return [{ when: { duration: 5 }, amount: 1.5 }, { when: { duration: 10 }, amount: 3 }]
}

function setProfiles(profiles: Record<string, unknown>) {
  for (const key of Object.keys(catalogState.profiles)) delete catalogState.profiles[key]
  Object.assign(catalogState.profiles, profiles)
}

describe('tgg json-driven catalog', () => {
  beforeEach(() => {
    catalogState.capabilities = [capabilityEntry()]
    catalogState.pricing = [pricingEntry(verifiedTiers())]
    setProfiles({ [FIXTURE_MODEL_ID]: { referenceFormat: 'categorized', ratios: ['16:9', '9:16'], aspectRatioField: true } })
  })

  it('selects a model only when capability, profile and per-duration pricing are all verified', () => {
    expect(listTggCatalogModels().map((model) => model.modelId)).toEqual([FIXTURE_MODEL_ID])
    expect(listTggSelectableModels().map((model) => model.modelId)).toEqual([FIXTURE_MODEL_ID])
  })

  it('keeps unprofiled models discoverable but never selectable', () => {
    setProfiles({})
    expect(listTggCatalogModels()).toHaveLength(1)
    expect(listTggSelectableModels()).toHaveLength(0)
  })

  it('rejects invalid profile data', () => {
    setProfiles({ [FIXTURE_MODEL_ID]: { referenceFormat: 'multipart', ratios: ['16:9'] } })
    expect(listTggSelectableModels()).toHaveLength(0)
    setProfiles({ [FIXTURE_MODEL_ID]: { referenceFormat: 'files' } })
    expect(listTggSelectableModels()).toHaveLength(0)
  })

  it('requires a positive amount tier for every selectable duration', () => {
    catalogState.pricing = []
    expect(listTggSelectableModels()).toHaveLength(0)

    catalogState.pricing = [pricingEntry([{ when: { duration: 5 }, amount: 1.5 }])]
    expect(listTggSelectableModels()).toHaveLength(0)

    catalogState.pricing = [pricingEntry([{ when: { duration: 5 }, amount: 1.5 }, { when: { duration: 10 }, amount: 0 }])]
    expect(listTggSelectableModels()).toHaveLength(0)

    catalogState.pricing = [pricingEntry(verifiedTiers())]
    expect(listTggSelectableModels()).toHaveLength(1)
  })

  it('never selects a model without duration options', () => {
    catalogState.capabilities = [capabilityEntry({ durationOptions: [] })]
    expect(listTggCatalogModels()).toHaveLength(1)
    expect(listTggSelectableModels()).toHaveLength(0)
  })

  it('ignores non-video entries and other providers', () => {
    catalogState.capabilities = [
      capabilityEntry(),
      { modelType: 'image', provider: 'tgg', modelId: 'tgg-fixture-image', capabilities: {} },
      { modelType: 'video', provider: 'kuaizi', modelId: FIXTURE_MODEL_ID, capabilities: {} },
    ]
    expect(listTggCatalogModels().map((model) => model.modelId)).toEqual([FIXTURE_MODEL_ID])
  })

  it('composes the definition from capability json and the verified profile', () => {
    const model = getTggModelDefinition(FIXTURE_MODEL_ID)
    expect(model).toMatchObject({
      modelId: FIXTURE_MODEL_ID,
      modality: 'video',
      referenceFormat: 'categorized',
      supportsImages: true,
      supportsVideos: true,
      supportsAudios: true,
      maxImages: 2,
      maxVideos: 1,
      maxAudios: 1,
      supportsResolution: true,
      supportsGenerateAudio: true,
      supportsAspectRatioField: true,
      supportsFirstLastFrame: false,
      durationOptions: [5, 10],
      ratios: ['16:9', '9:16'],
      resolutions: ['720p', '1080p'],
    })
  })

  it('throws MODEL_NOT_REGISTERED for ids absent from the capability catalog', () => {
    expect(() => getTggModelDefinition('tgg-unknown-model')).toThrow(`MODEL_NOT_REGISTERED: tgg/video/tgg-unknown-model`)
  })

  it('bills each duration at its exact verified tier amount', () => {
    expect(calcVideoByDuration(`tgg::${FIXTURE_MODEL_ID}`, 5, '720p')).toBe(1.5)
    expect(calcVideoByDuration(`tgg::${FIXTURE_MODEL_ID}`, 10, '1080p')).toBe(3)
  })
})
