import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resetServiceConfigCache } from '@/lib/service-config'
import { getPlatformServiceConfigResponse, savePlatformServiceConfig } from '@/lib/platform-services/config'

function fixturePath() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nori-platform-services-'))
  const filePath = path.join(directory, 'services.json')
  fs.writeFileSync(filePath, JSON.stringify({
    storage: { type: 'tos', tos: { endpoint: 'https://tos-cn-beijing.volces.com', publicEndpoint: 'https://tos-cn-beijing.volces.com', region: 'cn-beijing', bucket: 'bucket-a', accessKey: 'tos-ak-old', secretKey: 'tos-sk-old' } },
    llm: {
      providers: [
        { id: 'hfsy', name: 'HFSY', baseUrl: 'https://www.hfsyapi.cn/v1', apiKey: 'retired-key' },
        { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'deepseek-key-old', apiMode: 'openai-official' },
        { id: 'ark', name: 'Ark', apiKey: 'retired-ark-key' },
      ],
      models: [
        { modelId: 'deepseek-v4-pro', name: 'Legacy alias', type: 'llm', provider: 'deepseek' },
        { modelId: 'deepseek-chat', name: 'Injected alias', modelKey: 'hfsy::gpt-image-2', type: 'image', provider: 'deepseek', llmProtocol: 'responses' },
      ],
      defaultModels: { analysisModel: 'hfsy::gpt-5.5' },
      modelRouting: { 'nori::nori-gpt': 'hfsy::gpt-5.5', 'nori::nori-image': 'hfsy::gpt-image-2' },
    },
    videoRepaint: { providerId: 'ark', understandingModel: 'ark-model', fps: 0.5 },
  }))
  return filePath
}

describe('platform service config', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    resetServiceConfigCache()
  })

  it('publishes only DeepSeek and Kuaizi, removes retired fallbacks and masks secrets', () => {
    const filePath = fixturePath()
    vi.stubEnv('NORI_SERVICE_CONFIG', filePath)
    vi.stubEnv('ARK_API_KEY', 'must-not-return')
    vi.stubEnv('HFSY_API_KEY', 'must-not-return')
    resetServiceConfigCache()

    const config = getPlatformServiceConfigResponse()
    expect(config.providers.map((provider) => provider.id)).toEqual(['deepseek', 'kuaizi'])
    expect(config.providers.every((provider) => !('apiKey' in provider))).toBe(true)
    expect(config.providers[0].hasApiKey).toBe(true)
    expect(config.providers[1].hasApiKey).toBe(false)
    expect(config.models.some((model) => ['ark', 'hfsy', 'ghc'].includes(model.provider))).toBe(false)
    expect(config.models[0]).toMatchObject({ modelId: 'deepseek-chat', name: 'DeepSeek Chat', modelKey: 'deepseek::deepseek-chat', provider: 'deepseek', type: 'llm', llmProtocol: 'chat-completions' })
    expect(config.models.some((model) => model.provider === 'kuaizi' && model.type === 'llm')).toBe(false)
    expect(config.modelRouting['nori::nori-gpt']).toBe('deepseek::deepseek-chat')
    expect(config.modelRouting['nori::nori-image']).toBe('kuaizi::seedream5.0lite')
    expect(config.modelRouting['nori::nori-music']).toBe('')
    expect(config).not.toHaveProperty('videoRepaint')
  })

  it('preserves keys and saves only fixed models, valid routes and storage settings', async () => {
    const filePath = fixturePath()
    vi.stubEnv('NORI_SERVICE_CONFIG', filePath)
    resetServiceConfigCache()
    const before = getPlatformServiceConfigResponse()
    const saved = await savePlatformServiceConfig({
      providers: [...before.providers.filter((provider) => provider.id === 'deepseek'), { ...before.providers.find((provider) => provider.id === 'kuaizi'), apiKey: 'kuaizi-key-for-test', assetGroupId: '184860178674352156' }],
      models: [{ modelId: 'injected', type: 'video', provider: 'kuaizi' }],
      defaultModels: before.defaultModels,
      modelRouting: { 'nori::nori-gpt': 'deepseek::deepseek-reasoner', 'nori::nori-image': 'hfsy::injected', 'nori::nori-music': 'kuaizi::speech-2.8-hd' },
      storage: { ...before.storage, bucket: 'bucket-b' },
    })

    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    expect(raw.llm.providers[0].apiKey).toBe('deepseek-key-old')
    expect(raw.llm.providers[1].apiKey).toBe('kuaizi-key-for-test')
    expect(raw.llm.providers[1].assetGroupId).toBe('184860178674352156')
    expect(raw.llm.models.some((model: { modelId: string }) => model.modelId === 'injected')).toBe(false)
    expect(raw.llm.modelRouting['nori::nori-gpt']).toBe('deepseek::deepseek-reasoner')
    expect(raw.llm.modelRouting['nori::nori-image']).toBe('kuaizi::seedream5.0lite')
    expect(raw.llm.modelRouting['nori::nori-music']).toBeUndefined()
    expect(raw.videoRepaint).toBeUndefined()
    expect(raw.storage.tos.bucket).toBe('bucket-b')
    expect(raw.storage.tos.accessKey).toBe('tos-ak-old')
    expect(fs.statSync(filePath).mode & 0o777).toBe(0o600)
    expect(saved.providers.every((provider) => !('apiKey' in provider))).toBe(true)
  })

  it('rejects retired or additional provider connections', async () => {
    const filePath = fixturePath()
    vi.stubEnv('NORI_SERVICE_CONFIG', filePath)
    resetServiceConfigCache()
    const before = getPlatformServiceConfigResponse()
    await expect(savePlatformServiceConfig({ providers: [{ id: 'ark', name: 'Ark', apiKey: 'retired' }, before.providers[1]], storage: before.storage })).rejects.toThrow('unsupported provider ark')
    await expect(savePlatformServiceConfig({ providers: before.providers.filter((provider) => provider.id === 'deepseek'), storage: before.storage })).rejects.toThrow('providers')
    await expect(savePlatformServiceConfig({ providers: before.providers.map((provider) => ({ ...provider, baseUrl: 'https://proxy.example.com/v1' })), storage: before.storage })).rejects.toThrow('official base URL')
  })

  it('keeps an explicitly disabled capability disabled across saves', async () => {
    const filePath = fixturePath()
    vi.stubEnv('NORI_SERVICE_CONFIG', filePath)
    resetServiceConfigCache()
    const before = getPlatformServiceConfigResponse()
    await savePlatformServiceConfig({
      providers: before.providers,
      modelRouting: { ...before.modelRouting, 'nori::nori-image-pro': '' },
      storage: before.storage,
    })
    resetServiceConfigCache()
    const saved = getPlatformServiceConfigResponse()
    expect(saved.modelRouting['nori::nori-image-pro']).toBe('')
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    expect(raw.llm.modelRouting['nori::nori-image-pro']).toBe('')
    await savePlatformServiceConfig({
      providers: before.providers,
      modelRouting: saved.modelRouting,
      storage: before.storage,
    })
    resetServiceConfigCache()
    expect(getPlatformServiceConfigResponse().modelRouting['nori::nori-image-pro']).toBe('')
  })
})
