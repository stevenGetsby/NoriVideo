import { describe, expect, it } from 'vitest'
import { resolveConfiguredModelAvailability } from '@/lib/platform-services/model-availability'
import type { PlatformServiceConfigResponse } from '@/lib/platform-services/config'

const NOW = new Date('2026-07-17T12:00:00.000Z')

function platformConfig(overrides: Partial<PlatformServiceConfigResponse> = {}): PlatformServiceConfigResponse {
  return {
    sourceFile: 'services.json',
    updatedAt: '2026-07-17T11:00:00.000Z',
    providers: [{ id: 'ghc', name: 'GHC', hasApiKey: true }],
    models: [{
      modelId: 'gpt-5.5',
      modelKey: 'ghc::gpt-5.5',
      name: 'GPT 5.5',
      type: 'llm',
      provider: 'ghc',
    }],
    defaultModels: {},
    businessModels: [],
    modelRouting: {
      'nori::nori-gpt': 'ghc::gpt-5.5',
      'nori::nori-gpt-max': '',
      'nori::nori-gemini': '',
      'nori::nori-deepseek': '',
      'nori::nori-image-mini': '',
      'nori::nori-image-fast': '',
      'nori::nori-image': '',
      'nori::nori-image-pro': '',
      'nori::seedance2.0-mini': '',
      'nori::seedance2.0-fast': '',
      'nori::seedance2.0': '',
      'nori::norivideo2.5': '',
      'nori::nori-audio': '',
      'nori::nori-music': '',
      'nori::nori-sfx': '',
    },
    storage: {
      type: 'tos',
      endpoint: '',
      publicEndpoint: '',
      region: '',
      bucket: '',
      forcePathStyle: false,
      hasAccessKey: false,
      hasSecretKey: false,
    },
    videoRepaint: {
      providerId: 'ark',
      understandingModel: 'understanding',
      adaptationModel: 'adaptation',
      fps: 0.5,
    },
    ...overrides,
  }
}

describe('configured model availability', () => {
  it('allows a configured model before any health probe has run', () => {
    const result = resolveConfiguredModelAvailability({
      modelKey: 'nori::nori-gpt',
      type: 'llm',
      config: platformConfig(),
      health: [],
      now: NOW,
    })

    expect(result).toMatchObject({
      configured: true,
      available: true,
      runtimeModelKey: 'ghc::gpt-5.5',
      healthStatus: 'unknown',
      unavailableReason: null,
    })
  })

  it('blocks a provider only while its unhealthy result is fresh', () => {
    const result = resolveConfiguredModelAvailability({
      modelKey: 'nori::nori-gpt',
      type: 'llm',
      config: platformConfig(),
      health: [{
        targetType: 'provider',
        targetId: 'ghc',
        status: 'unhealthy',
        message: 'upstream timeout',
        checkedAt: '2026-07-17T11:55:00.000Z',
      }],
      now: NOW,
    })

    expect(result).toMatchObject({
      configured: true,
      available: false,
      healthStatus: 'unhealthy',
      healthMessage: 'upstream timeout',
      unavailableReason: 'upstream timeout',
    })
  })

  it('does not permanently disable a model from a stale unhealthy result', () => {
    const result = resolveConfiguredModelAvailability({
      modelKey: 'nori::nori-gpt',
      type: 'llm',
      config: platformConfig(),
      health: [{
        targetType: 'provider',
        targetId: 'ghc',
        status: 'unhealthy',
        message: 'old failure',
        checkedAt: '2026-07-17T10:00:00.000Z',
      }],
      now: NOW,
    })

    expect(result).toMatchObject({
      configured: true,
      available: true,
      healthStatus: 'unknown',
      healthMessage: '上次检测结果已过期：old failure',
      unavailableReason: null,
    })
  })

  it('invalidates a health result recorded before the service config changed', () => {
    const result = resolveConfiguredModelAvailability({
      modelKey: 'nori::nori-gpt',
      type: 'llm',
      config: platformConfig({ updatedAt: '2026-07-17T11:58:00.000Z' }),
      health: [{
        targetType: 'provider',
        targetId: 'ghc',
        status: 'unhealthy',
        checkedAt: '2026-07-17T11:55:00.000Z',
      }],
      now: NOW,
    })

    expect(result).toMatchObject({
      available: true,
      healthStatus: 'unknown',
      unavailableReason: null,
    })
  })

  it('rejects missing routes, missing secrets, and type mismatches', () => {
    const missingRoute = resolveConfiguredModelAvailability({
      modelKey: 'nori::nori-gpt-max',
      type: 'llm',
      config: platformConfig(),
      health: [],
      now: NOW,
    })
    const missingSecret = resolveConfiguredModelAvailability({
      modelKey: 'nori::nori-gpt',
      type: 'llm',
      config: platformConfig({ providers: [{ id: 'ghc', name: 'GHC', hasApiKey: false }] }),
      health: [],
      now: NOW,
    })
    const wrongType = resolveConfiguredModelAvailability({
      modelKey: 'nori::nori-gpt',
      type: 'image',
      config: platformConfig(),
      health: [],
      now: NOW,
    })

    expect(missingRoute.configured).toBe(false)
    expect(missingSecret).toMatchObject({ configured: false, available: false })
    expect(wrongType).toMatchObject({ configured: false, available: false })
  })
})
