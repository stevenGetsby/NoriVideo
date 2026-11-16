import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const routeState = vi.hoisted(() => ({ mapping: {} as Record<string, string> }))
const tggSelectableMock = vi.hoisted(() => vi.fn(() => [] as Array<{ modelId: string; name: string; modality: string }>))

vi.mock('@/lib/providers/tgg/routes', () => ({
  TGG_VIDEO_ROUTE_BY_BUSINESS_KEY: routeState.mapping,
  VIDEO_BUSINESS_KEYS: ['nori::norivideo2.5', 'nori::seedance2.0-mini', 'nori::seedance2.0-fast', 'nori::seedance2.0'],
}))
vi.mock('@/lib/providers/tgg/catalog', () => ({ listTggSelectableModels: tggSelectableMock }))

import { listNoriBusinessModels } from '@/lib/nori-model-catalog'
import { resetServiceConfigCache } from '@/lib/service-config'
import { savePlatformModelRouting } from '@/lib/platform-services/config'
import { deriveVideoProvider, planVideoProviderSwitch } from '@/lib/platform-services/video-provider-switch'

const VIDEO_KEYS = ['nori::norivideo2.5', 'nori::seedance2.0-mini', 'nori::seedance2.0-fast', 'nori::seedance2.0']

function kuaiziRouting(): Record<string, string> {
  return Object.fromEntries(listNoriBusinessModels('video').map((model) => [model.key, model.suggestedRoute]))
}

function fullTggMapping(): Record<string, string> {
  return {
    'nori::norivideo2.5': 'tgg::tgg-fixture-video',
    'nori::seedance2.0-mini': 'tgg::tgg-fixture-mini',
    'nori::seedance2.0-fast': 'tgg::tgg-fixture-fast',
    'nori::seedance2.0': 'tgg::tgg-fixture-pro',
  }
}

function planInput(overrides: Partial<Parameters<typeof planVideoProviderSwitch>[0]> = {}) {
  return {
    routing: kuaiziRouting(),
    businessModels: listNoriBusinessModels(),
    selectableTgg: Object.values(fullTggMapping()),
    hasTggKey: true,
    hasKuaiziKey: true,
    target: 'tgg' as const,
    ...overrides,
  }
}

function applyPlan(routing: Record<string, string>, plan: ReturnType<typeof planVideoProviderSwitch>) {
  const next = { ...routing }
  for (const row of plan.rows) {
    if (row.action === 'switch') next[row.businessKey] = row.to
  }
  return next
}

describe('video provider switch plan', () => {
  afterEach(() => {
    for (const key of Object.keys(routeState.mapping)) delete routeState.mapping[key]
  })

  it('switches every video model when the tgg mapping is complete', () => {
    Object.assign(routeState.mapping, fullTggMapping())
    const routing = kuaiziRouting()
    const plan = planVideoProviderSwitch(planInput({ routing }))
    expect(plan.current).toBe('kuaizi')
    expect(plan.blockers).toEqual([])
    expect(plan.rows).toHaveLength(4)
    expect(plan.rows.every((row) => row.action === 'switch')).toBe(true)
    expect(deriveVideoProvider(applyPlan(routing, plan), VIDEO_KEYS)).toBe('tgg')
  })

  it('keeps unmapped models on kuaizi with an explicit reason and reports mixed', () => {
    routeState.mapping['nori::norivideo2.5'] = 'tgg::tgg-fixture-video'
    const routing = kuaiziRouting()
    const plan = planVideoProviderSwitch(planInput({ routing, selectableTgg: ['tgg::tgg-fixture-video'] }))
    const switched = plan.rows.filter((row) => row.action === 'switch')
    const kept = plan.rows.filter((row) => row.action === 'keep')
    expect(switched.map((row) => row.businessKey)).toEqual(['nori::norivideo2.5'])
    expect(kept).toHaveLength(3)
    expect(kept.every((row) => row.reason === 'TGG 暂无对应模型')).toBe(true)
    expect(plan.blockers).toEqual([])
    expect(deriveVideoProvider(applyPlan(routing, plan), VIDEO_KEYS)).toBe('mixed')
  })

  it('marks mapped but unselectable models unavailable instead of switching them', () => {
    routeState.mapping['nori::norivideo2.5'] = 'tgg::tgg-fixture-video'
    const plan = planVideoProviderSwitch(planInput({ selectableTgg: [] }))
    const row = plan.rows.find((item) => item.businessKey === 'nori::norivideo2.5')
    expect(row).toMatchObject({ action: 'unavailable', reason: '该模型 TGG 未定价或能力未核实' })
    expect(plan.blockers).toContain('没有可切换的模型')
    expect(plan.applied).toBe(false)
  })

  it('blocks switching without a tgg key and stays unapplied', () => {
    Object.assign(routeState.mapping, fullTggMapping())
    const plan = planVideoProviderSwitch(planInput({ hasTggKey: false }))
    expect(plan.blockers).toContain('TGG 尚未配置 API Key')
    expect(plan.applied).toBe(false)
  })

  it('returns to suggested kuaizi routes and is idempotent on a second switch', () => {
    Object.assign(routeState.mapping, fullTggMapping())
    const tggRouting = applyPlan(kuaiziRouting(), planVideoProviderSwitch(planInput()))
    const back = planVideoProviderSwitch(planInput({ routing: tggRouting, target: 'kuaizi' }))
    expect(back.current).toBe('tgg')
    expect(back.rows.every((row) => row.action === 'switch' && row.to.startsWith('kuaizi::'))).toBe(true)
    const restored = applyPlan(tggRouting, back)
    expect(deriveVideoProvider(restored, VIDEO_KEYS)).toBe('kuaizi')

    const again = planVideoProviderSwitch(planInput({ routing: restored, target: 'kuaizi' }))
    expect(again.rows.every((row) => row.action === 'keep')).toBe(true)
    expect(again.blockers).toEqual([])
  })
})

function fixturePath(tggApiKey?: string) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nori-video-switch-'))
  const filePath = path.join(directory, 'services.json')
  fs.writeFileSync(filePath, JSON.stringify({
    storage: { type: 'tos', tos: { endpoint: 'https://tos-cn-beijing.volces.com', publicEndpoint: 'https://tos-cn-beijing.volces.com', region: 'cn-beijing', bucket: 'bucket-a', accessKey: 'tos-ak-old', secretKey: 'tos-sk-old' } },
    llm: {
      providers: [
        { id: 'deepseek', name: 'DeepSeek 官方', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'deepseek-key-old' },
        { id: 'openlux', name: 'OpenLux API', baseUrl: 'https://api.openlux.ai/v1' },
        { id: 'kuaizi', name: 'Kuaizi API', baseUrl: 'https://aiopenapi.kuaizi.cn', apiKey: 'kuaizi-key-old' },
        { id: 'huimengi', name: '绘梦工坊 API', baseUrl: 'https://api.huimengi.com' },
        { id: 'tgg', name: 'TGG Token API', baseUrl: 'https://tggtoken.org', ...(tggApiKey ? { apiKey: tggApiKey } : {}) },
      ],
      models: [],
      defaultModels: {},
      modelRouting: {},
    },
  }))
  return filePath
}

function stubPlatformEnv() {
  vi.stubEnv('DEEPSEEK_API_KEY', '')
  vi.stubEnv('OPENLUX_API_KEY', '')
  vi.stubEnv('KUAIZI_API_KEY', '')
  vi.stubEnv('HUIMENGI_API_KEY', '')
  vi.stubEnv('TGG_API_KEY', '')
}

describe('savePlatformModelRouting', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    tggSelectableMock.mockReturnValue([])
    resetServiceConfigCache()
  })

  it('only rewrites routing while providers, keys and storage stay byte-identical', async () => {
    const filePath = fixturePath('tgg-test-secret-value')
    vi.stubEnv('NORI_SERVICE_CONFIG', filePath)
    stubPlatformEnv()
    resetServiceConfigCache()
    tggSelectableMock.mockReturnValue([{ modelId: 'tgg-fixture-video', name: 'TGG Fixture Video', modality: 'video' }])

    const beforeRaw = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    const saved = await savePlatformModelRouting({ 'nori::norivideo2.5': 'tgg::tgg-fixture-video' })
    const afterRaw = JSON.parse(fs.readFileSync(filePath, 'utf8'))

    expect(afterRaw.llm.providers).toEqual(beforeRaw.llm.providers)
    expect(afterRaw.storage).toEqual(beforeRaw.storage)
    expect(afterRaw.llm.modelRouting['nori::norivideo2.5']).toBe('tgg::tgg-fixture-video')
    expect(afterRaw.llm.modelRouting['nori::seedance2.0-mini']).toBe('kuaizi::doubao-seedance-2-0-mini-260615')
    expect(saved.modelRouting['nori::norivideo2.5']).toBe('tgg::tgg-fixture-video')
    expect(JSON.stringify(saved)).not.toContain('tgg-test-secret-value')
    expect(fs.statSync(filePath).mode & 0o777).toBe(0o600)
  })

  it('refuses a tgg route when no usable key exists and leaves the file untouched', async () => {
    const filePath = fixturePath()
    vi.stubEnv('NORI_SERVICE_CONFIG', filePath)
    stubPlatformEnv()
    resetServiceConfigCache()
    tggSelectableMock.mockReturnValue([{ modelId: 'tgg-fixture-video', name: 'TGG Fixture Video', modality: 'video' }])

    const before = fs.readFileSync(filePath, 'utf8')
    await expect(savePlatformModelRouting({ 'nori::norivideo2.5': 'tgg::tgg-fixture-video' }))
      .rejects.toThrow('TGG 尚未配置 API Key')
    expect(fs.readFileSync(filePath, 'utf8')).toBe(before)
  })
})
