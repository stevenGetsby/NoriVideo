import { beforeEach, describe, expect, it, vi } from 'vitest'

const routingState = vi.hoisted(() => ({ modelRouting: undefined as Record<string, string> | undefined }))

vi.mock('@/lib/service-config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/service-config')>()),
  getServiceLlmConfig: () => (routingState.modelRouting ? { modelRouting: routingState.modelRouting } : undefined),
}))

import { calcVideo } from '@/lib/billing/cost'
import {
  listNoriBusinessModels,
  normalizeProjectBusinessModelKey,
  resolveNoriModelRoute,
  resolveRuntimeModelKey,
} from '@/lib/nori-model-catalog'

const SEEDANCE_KEY = 'nori::tgg-seedance2.5'
const VIG_KEY = 'nori::tgg-vig2.5'

describe('TGG business video models', () => {
  beforeEach(() => {
    routingState.modelRouting = undefined
  })

  it('registers both relays as video business models that default to their TGG relay tier', () => {
    const keys = listNoriBusinessModels('video').map((model) => model.key)
    expect(keys).toContain(SEEDANCE_KEY)
    expect(keys).toContain(VIG_KEY)
    expect(resolveNoriModelRoute(SEEDANCE_KEY)).toBe('tgg::seedance_v2.5_full')
    expect(resolveNoriModelRoute(VIG_KEY)).toBe('tgg::vig-S2.5-480-秒')
  })

  it('resolves each business key to its own TGG relay once routed', () => {
    routingState.modelRouting = {
      [SEEDANCE_KEY]: 'tgg::seedance_v2.5_full',
      [VIG_KEY]: 'tgg::vig-S2.5-480-秒',
    }
    expect(resolveRuntimeModelKey(SEEDANCE_KEY)).toBe('tgg::seedance_v2.5_full')
    expect(resolveRuntimeModelKey(VIG_KEY)).toBe('tgg::vig-S2.5-480-秒')
  })

  it('maps a legacy raw TGG key back to its business key instead of rejecting it', () => {
    routingState.modelRouting = {
      [SEEDANCE_KEY]: 'tgg::seedance_v2.5_full',
      [VIG_KEY]: 'tgg::vig-S2.5-480-秒',
    }
    expect(normalizeProjectBusinessModelKey('tgg::seedance_v2.5_full', 'video')).toBe(SEEDANCE_KEY)
    expect(normalizeProjectBusinessModelKey('tgg::vig-S2.5-480-秒', 'video')).toBe(VIG_KEY)
  })

  it('bills Seedance 2.5 Full per request at the relay tier', () => {
    routingState.modelRouting = { [SEEDANCE_KEY]: 'tgg::seedance_v2.5_full' }
    expect(calcVideo(SEEDANCE_KEY, '720p', 1, { duration: 5 })).toBe(6.5)
    expect(calcVideo(SEEDANCE_KEY, '720p', 1, { duration: 30 })).toBe(6.5)
  })

  it('bills vig-S2.5-480 per second at the relay tier', () => {
    routingState.modelRouting = { [VIG_KEY]: 'tgg::vig-S2.5-480-秒' }
    expect(calcVideo(VIG_KEY, '720p', 1, { duration: 5 })).toBe(2)
    expect(calcVideo(VIG_KEY, '720p', 1, { duration: 30 })).toBe(12)
  })
})
