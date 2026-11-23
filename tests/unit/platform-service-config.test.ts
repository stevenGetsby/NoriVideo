import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const tggSelectableMock = vi.hoisted(() => vi.fn(() => [] as Array<{ modelId: string; name: string; modality: string }>))
vi.mock('@/lib/providers/tgg/catalog', () => ({ listTggSelectableModels: tggSelectableMock }))

import { resetServiceConfigCache } from '@/lib/service-config'
import { getPlatformServiceConfigResponse, savePlatformServiceConfig } from '@/lib/platform-services/config'
import { listConfiguredSelectableModels } from '@/lib/platform-services/model-selection'

const TGG_VERIFIED_MODELS = [
  { modelId: 'seedance_v2.5_full', name: 'Seedance 2.5 Full', modality: 'video' },
  { modelId: 'vig-S2.5-480-秒', name: 'vig-S2.5-480', modality: 'video' },
]

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
  vi.stubEnv('TGG_API_KEY', '')
  vi.stubEnv('KIMI_API_KEY', '')
  vi.stubEnv('OPENAI_API_KEY', '')
  vi.stubEnv('ARK_API_KEY', 'must-not-return')
  vi.stubEnv('HFSY_API_KEY', 'must-not-return')
}

describe('platform service config', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    tggSelectableMock.mockReturnValue([])
    resetServiceConfigCache()
  })

  it('publishes configured providers, removes retired fallbacks and masks secrets', () => {
    const filePath = fixturePath()
    vi.stubEnv('NORI_SERVICE_CONFIG', filePath)
    stubPlatformEnv()
    resetServiceConfigCache()

    const config = getPlatformServiceConfigResponse()
    expect(config.providers.map((provider) => provider.id)).toEqual(['deepseek', 'openlux', 'kuaizi', 'huimengi', 'tgg', 'kimi', 'openai'])
    expect(config.canvasAgentModelCatalog.defaultModelKey).toBeNull()
    expect(config.providers.every((provider) => !('apiKey' in provider))).toBe(true)
    expect(config.providers[0].hasApiKey).toBe(true)
    expect(config.providers[1].hasApiKey).toBe(false)
    expect(config.providers[2].hasApiKey).toBe(false)
    expect(config.providers[3].hasApiKey).toBe(false)
    // Old config files without a tgg entry gain an empty-key provider on read.
    expect(config.providers[4]).toMatchObject({ id: 'tgg', name: 'TGG Token API', baseUrl: 'https://tggtoken.org', hasApiKey: false })
    expect(config.models.some((model) => model.provider === 'tgg')).toBe(false)
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

  it('cannot enable an unverified agent model or persist part of an invalid save', async () => {
    const filePath = fixturePath()
    vi.stubEnv('NORI_SERVICE_CONFIG', filePath)
    stubPlatformEnv()
    resetServiceConfigCache()
    const before = fs.readFileSync(filePath, 'utf8')
    const config = getPlatformServiceConfigResponse()
    const key = 'deepseek::deepseek-flash'
    await expect(savePlatformServiceConfig({
      ...config,
      providers: config.providers.map((row) => row.id === 'openai' ? { ...row, apiKey: 'local-fixture-key' } : row),
      modelRouting: { ...config.modelRouting, 'nori::canvas-agent': key },
      agentModels: { [key]: { canvasAgent: true, toolStreamingVerified: true } },
    })).rejects.toThrow(/喵导/)
    expect(fs.readFileSync(filePath, 'utf8')).toBe(before)
    const saved = await savePlatformServiceConfig({
      ...config,
      providers: config.providers.map((row) => row.id === 'openai' ? { ...row, apiKey: 'local-fixture-key' } : row),
      agentModels: {},
    })
    expect(saved.providers.find((row) => row.id === 'openai')).toMatchObject({ hasApiKey: true })
    expect(JSON.stringify(saved)).not.toContain('local-fixture-key')
    expect(saved.modelRouting['nori::canvas-agent']).toBe('')
    expect(saved.models.some((row) => row.provider === 'openai')).toBe(false)
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
    expect(raw.llm.providers.map((provider: { id: string }) => provider.id)).toEqual(['deepseek', 'openlux', 'kuaizi', 'huimengi', 'tgg', 'kimi', 'openai'])
    expect(raw.llm.providers[0].apiKey).toBe('deepseek-key-old')
    expect(raw.llm.providers[1].apiKey).toBeUndefined()
    expect(raw.llm.providers[2].apiKey).toBe('kuaizi-key-for-test')
    expect(raw.llm.providers[3].apiKey).toBeUndefined()
    expect(raw.llm.providers[4].apiKey).toBeUndefined()
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

  it('uses TGG_API_KEY as the TGG environment fallback without echoing it', () => {
    const filePath = fixturePath()
    vi.stubEnv('NORI_SERVICE_CONFIG', filePath)
    stubPlatformEnv()
    vi.stubEnv('TGG_API_KEY', 'tgg-env-key-for-test')
    resetServiceConfigCache()

    const config = getPlatformServiceConfigResponse()
    const tgg = config.providers.find((provider) => provider.id === 'tgg')
    expect(tgg?.hasApiKey).toBe(true)
    expect(JSON.stringify(config)).not.toContain('tgg-env-key-for-test')
  })

  it('only exposes verified TGG models and refuses TGG routes without a key', async () => {
    const filePath = fixturePath()
    vi.stubEnv('NORI_SERVICE_CONFIG', filePath)
    stubPlatformEnv()
    resetServiceConfigCache()
    tggSelectableMock.mockReturnValue([{ modelId: 'tgg-fixture-video', name: 'TGG Fixture Video', modality: 'video' }])

    const before = getPlatformServiceConfigResponse()
    expect(before.models.some((model) => model.modelKey === 'tgg::tgg-fixture-video' && model.type === 'video')).toBe(true)

    const routeToTgg = { ...before.modelRouting, 'nori::norivideo2.5': 'tgg::tgg-fixture-video' }
    await expect(savePlatformServiceConfig({
      providers: before.providers,
      modelRouting: routeToTgg,
      storage: before.storage,
    })).rejects.toThrow('TGG 尚未配置 API Key')
    expect(JSON.parse(fs.readFileSync(filePath, 'utf8')).llm.modelRouting['nori::norivideo2.5']).not.toBe('tgg::tgg-fixture-video')

    const saved = await savePlatformServiceConfig({
      providers: before.providers.map((provider) => provider.id === 'tgg' ? { ...provider, apiKey: 'tgg-test-secret-value' } : provider),
      modelRouting: routeToTgg,
      storage: before.storage,
    })
    expect(saved.modelRouting['nori::norivideo2.5']).toBe('tgg::tgg-fixture-video')
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    expect(raw.llm.providers[4].apiKey).toBe('tgg-test-secret-value')
    expect(JSON.stringify(saved)).not.toContain('tgg-test-secret-value')
  })

  it('accepts a TGG route backed only by the environment key', async () => {
    const filePath = fixturePath()
    vi.stubEnv('NORI_SERVICE_CONFIG', filePath)
    stubPlatformEnv()
    vi.stubEnv('TGG_API_KEY', 'tgg-env-key-for-test')
    resetServiceConfigCache()
    tggSelectableMock.mockReturnValue([{ modelId: 'tgg-fixture-video', name: 'TGG Fixture Video', modality: 'video' }])

    const before = getPlatformServiceConfigResponse()
    const saved = await savePlatformServiceConfig({
      providers: before.providers,
      modelRouting: { ...before.modelRouting, 'nori::norivideo2.5': 'tgg::tgg-fixture-video' },
      storage: before.storage,
    })
    expect(saved.modelRouting['nori::norivideo2.5']).toBe('tgg::tgg-fixture-video')
    expect(JSON.stringify(saved)).not.toContain('tgg-env-key-for-test')
  })

  it('routes both TGG relays to their defaults once a TGG key exists, without an admin route', () => {
    const filePath = fixturePath()
    vi.stubEnv('NORI_SERVICE_CONFIG', filePath)
    stubPlatformEnv()
    vi.stubEnv('TGG_API_KEY', 'tgg-env-key-for-test')
    resetServiceConfigCache()
    tggSelectableMock.mockReturnValue(TGG_VERIFIED_MODELS)

    const config = getPlatformServiceConfigResponse()
    expect(config.modelRouting['nori::tgg-seedance2.5']).toBe('tgg::seedance_v2.5_full')
    expect(config.modelRouting['nori::tgg-vig2.5']).toBe('tgg::vig-S2.5-480-秒')
    const listed = listConfiguredSelectableModels(config, 'video').map((model) => model.modelKey)
    expect(listed).toEqual(expect.arrayContaining(['nori::tgg-seedance2.5', 'nori::tgg-vig2.5']))
  })

  it('keeps TGG relays unrouted without a key and saving the unchanged form does not persist a disable', async () => {
    const filePath = fixturePath()
    vi.stubEnv('NORI_SERVICE_CONFIG', filePath)
    stubPlatformEnv()
    resetServiceConfigCache()
    tggSelectableMock.mockReturnValue(TGG_VERIFIED_MODELS)

    const before = getPlatformServiceConfigResponse()
    expect(before.modelRouting['nori::tgg-seedance2.5']).toBe('')
    await savePlatformServiceConfig({ providers: before.providers, modelRouting: before.modelRouting, storage: before.storage })

    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    expect(raw.llm.modelRouting).not.toHaveProperty('nori::tgg-seedance2.5')
    expect(raw.llm.modelRouting).not.toHaveProperty('nori::tgg-vig2.5')
    resetServiceConfigCache()
    expect(getPlatformServiceConfigResponse().modelRouting['nori::tgg-seedance2.5']).toBe('')
  })

  it('applies TGG defaults when the key is entered in the same save as a form that showed them unrouted', async () => {
    const filePath = fixturePath()
    vi.stubEnv('NORI_SERVICE_CONFIG', filePath)
    stubPlatformEnv()
    resetServiceConfigCache()
    tggSelectableMock.mockReturnValue(TGG_VERIFIED_MODELS)

    const before = getPlatformServiceConfigResponse()
    const saved = await savePlatformServiceConfig({
      providers: before.providers.map((provider) => provider.id === 'tgg' ? { ...provider, apiKey: 'tgg-test-secret-value' } : provider),
      modelRouting: before.modelRouting,
      storage: before.storage,
    })
    expect(saved.modelRouting['nori::tgg-seedance2.5']).toBe('tgg::seedance_v2.5_full')
    expect(saved.modelRouting['nori::tgg-vig2.5']).toBe('tgg::vig-S2.5-480-秒')
    expect(JSON.stringify(saved)).not.toContain('tgg-test-secret-value')
  })

  it('keeps an administrator disable of a TGG relay across saves while the key is configured', async () => {
    const filePath = fixturePath()
    vi.stubEnv('NORI_SERVICE_CONFIG', filePath)
    stubPlatformEnv()
    vi.stubEnv('TGG_API_KEY', 'tgg-env-key-for-test')
    resetServiceConfigCache()
    tggSelectableMock.mockReturnValue(TGG_VERIFIED_MODELS)

    const before = getPlatformServiceConfigResponse()
    const disabled = await savePlatformServiceConfig({
      providers: before.providers,
      modelRouting: { ...before.modelRouting, 'nori::tgg-vig2.5': '' },
      storage: before.storage,
    })
    expect(disabled.modelRouting['nori::tgg-vig2.5']).toBe('')
    const resaved = await savePlatformServiceConfig({ providers: before.providers, modelRouting: disabled.modelRouting, storage: before.storage })
    expect(resaved.modelRouting['nori::tgg-vig2.5']).toBe('')
    expect(resaved.modelRouting['nori::tgg-seedance2.5']).toBe('tgg::seedance_v2.5_full')
  })

  it('lets an administrator route a TGG business model to another relay', async () => {
    const filePath = fixturePath()
    vi.stubEnv('NORI_SERVICE_CONFIG', filePath)
    stubPlatformEnv()
    vi.stubEnv('TGG_API_KEY', 'tgg-env-key-for-test')
    resetServiceConfigCache()
    tggSelectableMock.mockReturnValue(TGG_VERIFIED_MODELS)

    const before = getPlatformServiceConfigResponse()
    const saved = await savePlatformServiceConfig({
      providers: before.providers,
      modelRouting: { ...before.modelRouting, 'nori::tgg-seedance2.5': 'kuaizi::doubao-seedance-2-5-260628' },
      storage: before.storage,
    })
    expect(saved.modelRouting['nori::tgg-seedance2.5']).toBe('kuaizi::doubao-seedance-2-5-260628')
  })
})
