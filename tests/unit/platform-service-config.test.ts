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

function stubPlatformEnv() {
  vi.stubEnv('DEEPSEEK_API_KEY', '')
  vi.stubEnv('OPENLUX_API_KEY', '')
  vi.stubEnv('KUAIZI_API_KEY', '')
  vi.stubEnv('HUIMENGI_API_KEY', '')
  vi.stubEnv('ARK_API_KEY', 'must-not-return')
  vi.stubEnv('HFSY_API_KEY', 'must-not-return')
}

describe('platform service config', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    resetServiceConfigCache()
  })

  it('publishes only DeepSeek, OpenLux, Kuaizi and HuiMeng, removes retired fallbacks and masks secrets', () => {
    const filePath = fixturePath()
    vi.stubEnv('NORI_SERVICE_CONFIG', filePath)
    stubPlatformEnv()
    resetServiceConfigCache()

    const config = getPlatformServiceConfigResponse()
    expect(config.providers.map((provider) => provider.id)).toEqual(['deepseek', 'openlux', 'kuaizi', 'huimengi'])
    expect(config.providers.every((provider) => !('apiKey' in provider))).toBe(true)
    expect(config.providers[0].hasApiKey).toBe(true)
    expect(config.providers[1].hasApiKey).toBe(false)
    expect(config.providers[2].hasApiKey).toBe(false)
    expect(config.providers[3].hasApiKey).toBe(false)
    expect(config.models.some((model) => ['ark', 'hfsy', 'ghc'].includes(model.provider))).toBe(false)
    expect(config.models[0]).toMatchObject({ modelId: 'deepseek-chat', name: 'DeepSeek Chat', modelKey: 'deepseek::deepseek-chat', provider: 'deepseek', type: 'llm', llmProtocol: 'chat-completions' })
    expect(config.models.some((model) => model.provider === 'kuaizi' && model.type === 'llm')).toBe(false)
    expect(config.models.some((model) => model.provider === 'kuaizi' && model.type === 'image')).toBe(false)
    expect(config.models.filter((model) => model.provider === 'openlux').map((model) => [model.modelKey, model.type])).toEqual([
      ['openlux::gpt-image-2.5-flare', 'image'],
      ['openlux::gpt-image-2.5-sunburst', 'image'],
      ['openlux::gpt-image-2.5-flare-c', 'image'],
      ['openlux::gpt-image-2.5-sunburst-c', 'image'],
      ['openlux::gpt-image-2.6-flare-c', 'image'],
      ['openlux::gpt-image-2.6-sunburst-c', 'image'],
    ])
    // Ratio-priced models without a deterministic per-image price stay
    // registered but must never reach a paying workflow selection.
    expect(config.models.some((model) => model.provider === 'openlux' && ['gpt-image-2.6-flare', 'gpt-image-2.6-sunburst'].includes(model.modelId))).toBe(false)
    expect(config.modelRouting['nori::nori-gpt']).toBe('deepseek::deepseek-chat')
    expect(config.modelRouting['nori::nori-image-mini']).toBe('openlux::gpt-image-2.5-flare')
    expect(config.modelRouting['nori::nori-image-fast']).toBe('openlux::gpt-image-2.5-flare')
    expect(config.modelRouting['nori::nori-image']).toBe('openlux::gpt-image-2.5-sunburst')
    expect(config.modelRouting['nori::nori-image-pro']).toBe('openlux::gpt-image-2.5-sunburst')
    expect(config.modelRouting['nori::nori-image-2.6']).toBe('openlux::gpt-image-2.6-flare-c')
    expect(config.modelRouting['nori::nori-image-2.6-pro']).toBe('openlux::gpt-image-2.6-sunburst-c')
    expect(config.modelRouting['nori::nori-music']).toBe('')
    expect(config).not.toHaveProperty('videoRepaint')
  })

  it('uses OPENLUX_API_KEY as the OpenLux environment fallback without echoing it', () => {
    const filePath = fixturePath()
    vi.stubEnv('NORI_SERVICE_CONFIG', filePath)
    stubPlatformEnv()
    vi.stubEnv('OPENLUX_API_KEY', 'openlux-env-key-for-test')
    resetServiceConfigCache()

    const config = getPlatformServiceConfigResponse()
    const openlux = config.providers.find((provider) => provider.id === 'openlux')
    expect(openlux?.hasApiKey).toBe(true)
    expect(JSON.stringify(config)).not.toContain('openlux-env-key-for-test')
  })

  it('preserves keys and saves only fixed models, valid routes and storage settings', async () => {
    const filePath = fixturePath()
    vi.stubEnv('NORI_SERVICE_CONFIG', filePath)
    stubPlatformEnv()
    resetServiceConfigCache()
    const before = getPlatformServiceConfigResponse()
    const saved = await savePlatformServiceConfig({
      providers: before.providers.map((provider) => provider.id === 'kuaizi'
        ? { ...provider, apiKey: 'kuaizi-key-for-test', assetGroupId: '184860178674352156' }
        : provider),
      models: [{ modelId: 'injected', type: 'video', provider: 'kuaizi' }],
      defaultModels: before.defaultModels,
      modelRouting: { 'nori::nori-gpt': 'deepseek::deepseek-reasoner', 'nori::nori-image': 'hfsy::injected', 'nori::nori-music': 'kuaizi::speech-2.8-hd' },
      storage: { ...before.storage, bucket: 'bucket-b' },
    })

    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    expect(raw.llm.providers.map((provider: { id: string }) => provider.id)).toEqual(['deepseek', 'openlux', 'kuaizi', 'huimengi'])
    expect(raw.llm.providers[0].apiKey).toBe('deepseek-key-old')
    expect(raw.llm.providers[1].apiKey).toBeUndefined()
    expect(raw.llm.providers[2].apiKey).toBe('kuaizi-key-for-test')
    expect(raw.llm.providers[3].apiKey).toBeUndefined()
    expect(raw.llm.providers[2].assetGroupId).toBe('184860178674352156')
    expect(raw.llm.models.some((model: { modelId: string }) => model.modelId === 'injected')).toBe(false)
    expect(raw.llm.modelRouting['nori::nori-gpt']).toBe('deepseek::deepseek-reasoner')
    expect(raw.llm.modelRouting['nori::nori-image']).toBe('openlux::gpt-image-2.5-sunburst')
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
    stubPlatformEnv()
    resetServiceConfigCache()
    const before = getPlatformServiceConfigResponse()
    await expect(savePlatformServiceConfig({ providers: [{ id: 'ark', name: 'Ark', apiKey: 'retired' }, ...before.providers.slice(0, 2)], storage: before.storage })).rejects.toThrow('unsupported provider ark')
    await expect(savePlatformServiceConfig({ providers: before.providers.filter((provider) => provider.id === 'deepseek'), storage: before.storage })).rejects.toThrow('providers')
    await expect(savePlatformServiceConfig({ providers: before.providers.map((provider) => ({ ...provider, baseUrl: 'https://proxy.example.com/v1' })), storage: before.storage })).rejects.toThrow('official base URL')
  })

  it('keeps an explicitly disabled capability disabled across saves', async () => {
    const filePath = fixturePath()
    vi.stubEnv('NORI_SERVICE_CONFIG', filePath)
    stubPlatformEnv()
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
