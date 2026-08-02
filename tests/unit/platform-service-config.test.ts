import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resetServiceConfigCache } from '@/lib/service-config'
import {
  getPlatformServiceConfigResponse,
  savePlatformServiceConfig,
} from '@/lib/platform-services/config'

function fixturePath() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nori-platform-services-'))
  const filePath = path.join(directory, 'services.json')
  fs.writeFileSync(filePath, JSON.stringify({
    storage: {
      type: 'tos',
      tos: {
        endpoint: 'https://tos-cn-beijing.volces.com',
        publicEndpoint: 'https://tos-cn-beijing.volces.com',
        region: 'cn-beijing',
        bucket: 'bucket-a',
        accessKey: 'tos-ak-old',
        secretKey: 'tos-sk-old',
      },
    },
    llm: {
      providers: [{
        id: 'ghc',
        name: 'GHC',
        baseUrl: 'http://127.0.0.1:8313/v1',
        apiKey: 'ghc-key-old',
        gatewayRoute: 'openai-compat',
      }],
      models: [{
        modelId: 'gpt-5.5',
        modelKey: 'ghc::gpt-5.5',
        name: 'GPT 5.5',
        type: 'llm',
        provider: 'ghc',
        llmProtocol: 'responses',
      }],
      defaultModels: { analysisModel: 'ghc::gpt-5.5' },
      modelRouting: { 'nori::nori-gpt': 'ghc::gpt-5.5' },
    },
    videoRepaint: {
      providerId: 'ghc',
      understandingModel: 'gpt-5.5',
      adaptationModel: 'gpt-5.5',
      fps: 0.5,
    },
  }))
  return filePath
}

describe('platform service config', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    resetServiceConfigCache()
  })

  it('masks stored secrets and preserves them when an admin saves blank key fields', async () => {
    const filePath = fixturePath()
    vi.stubEnv('NORI_SERVICE_CONFIG', filePath)
    resetServiceConfigCache()

    const before = getPlatformServiceConfigResponse()
    expect(before.businessModels.filter((model) => model.type === 'audio').map((model) => model.key)).toEqual([
      'nori::nori-audio',
      'nori::nori-music',
      'nori::nori-sfx',
    ])
    expect(before.providers[0]).not.toHaveProperty('apiKey')
    expect(before.providers[0].hasApiKey).toBe(true)
    expect(before.storage.hasAccessKey).toBe(true)

    const saved = await savePlatformServiceConfig({
      providers: [{
        id: 'ghc',
        name: 'GHC Server',
        baseUrl: 'http://127.0.0.1:18313/v1',
        gatewayRoute: 'openai-compat',
      }],
      models: before.models,
      defaultModels: before.defaultModels,
      modelRouting: before.modelRouting,
      storage: {
        ...before.storage,
        bucket: 'bucket-b',
      },
      videoRepaint: before.videoRepaint,
    })

    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as {
      storage: { tos: { accessKey: string; secretKey: string; bucket: string } }
      llm: { providers: Array<{ apiKey: string }>; modelRouting: Record<string, string> }
    }
    expect(raw.llm.providers[0].apiKey).toBe('ghc-key-old')
    expect(raw.storage.tos.accessKey).toBe('tos-ak-old')
    expect(raw.storage.tos.secretKey).toBe('tos-sk-old')
    expect(raw.storage.tos.bucket).toBe('bucket-b')
    expect(raw.llm.modelRouting['nori::nori-gpt']).toBe('ghc::gpt-5.5')
    expect(saved.providers[0]).not.toHaveProperty('apiKey')
  })

  it('stores Kuaizi metadata and key in a mode-0600 file without returning the key', async () => {
    const filePath = fixturePath()
    vi.stubEnv('NORI_SERVICE_CONFIG', filePath)
    resetServiceConfigCache()

    const before = getPlatformServiceConfigResponse()
    const saved = await savePlatformServiceConfig({
      providers: [
        ...before.providers,
        {
          id: 'kuaizi',
          name: '筷子 AI 开放平台',
          baseUrl: 'https://aiopenapi.kuaizi.cn',
          apiKey: 'kuaizi-key-for-test',
          assetGroupId: '184860178674352156',
          gatewayRoute: 'official',
        },
      ],
      models: [
        ...before.models,
        {
          modelId: 'seedream5.0lite',
          modelKey: 'kuaizi::seedream5.0lite',
          name: 'Seedream 5.0 Lite',
          type: 'image',
          provider: 'kuaizi',
        },
      ],
      defaultModels: before.defaultModels,
      modelRouting: before.modelRouting,
      storage: before.storage,
      videoRepaint: before.videoRepaint,
    })

    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as {
      llm: { providers: Array<{ id: string; apiKey?: string; assetGroupId?: string }> }
    }
    const rawKuaizi = raw.llm.providers.find((provider) => provider.id === 'kuaizi')
    const responseKuaizi = saved.providers.find((provider) => provider.id === 'kuaizi')

    expect(rawKuaizi).toMatchObject({
      apiKey: 'kuaizi-key-for-test',
      assetGroupId: '184860178674352156',
    })
    expect(responseKuaizi).toMatchObject({
      assetGroupId: '184860178674352156',
      hasApiKey: true,
    })
    expect(responseKuaizi).not.toHaveProperty('apiKey')
    expect(fs.statSync(filePath).mode & 0o777).toBe(0o600)
  })
})
