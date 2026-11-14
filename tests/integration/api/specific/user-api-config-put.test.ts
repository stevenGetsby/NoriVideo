import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../../helpers/request'
import { installAuthMocks, mockAuthenticated, resetAuthMockState } from '../../../helpers/auth'

const prismaMock = vi.hoisted(() => ({ userPreference: { findUnique: vi.fn(), upsert: vi.fn() } }))
const configMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/platform-services/config', () => ({ getPlatformServiceConfigResponse: configMock }))
const context = { params: Promise.resolve({}) }

describe('platform-controlled user API config', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    resetAuthMockState()
    prismaMock.userPreference.findUnique.mockResolvedValue({ analysisModel: 'hfsy::legacy', analysisConcurrency: 3 })
    prismaMock.userPreference.upsert.mockResolvedValue({})
    configMock.mockReturnValue({
      providers: [
        { id: 'deepseek', name: 'DeepSeek', hasApiKey: true },
        { id: 'openlux', name: 'OpenLux', hasApiKey: false },
        { id: 'kuaizi', name: 'Kuaizi', hasApiKey: true },
        { id: 'huimengi', name: 'HuiMeng', hasApiKey: false },
      ],
      models: [
        { modelId: 'deepseek-chat', name: 'DeepSeek Chat', provider: 'deepseek', type: 'llm' },
        { modelId: 'gpt-image-2.5-sunburst', name: 'Internal image alias', provider: 'openlux', type: 'image' },
        { modelId: 'doubao-seedance-2-5-260628', name: 'Internal video alias', provider: 'kuaizi', type: 'video' },
        { modelId: 'speech-2.8-hd', name: 'Internal speech alias', provider: 'kuaizi', type: 'audio' },
      ],
      defaultModels: { analysisModel: 'nori::nori-gpt' },
      businessModels: [
        { key: 'nori::nori-gpt', name: 'nori-gpt', description: '', type: 'llm', tier: 'standard' },
        { key: 'nori::nori-image', name: 'nori-image', description: '', type: 'image', tier: 'standard' },
        { key: 'nori::norivideo2.5', name: 'LanMiaoTV 2.5', description: '', type: 'video', tier: 'pro' },
        { key: 'nori::nori-audio', name: 'nori-audio', description: '', type: 'audio', tier: 'standard' },
      ],
      modelRouting: {
        'nori::nori-gpt': 'deepseek::deepseek-chat',
        'nori::nori-image': 'openlux::gpt-image-2.5-sunburst',
        'nori::norivideo2.5': 'kuaizi::doubao-seedance-2-5-260628',
        'nori::nori-audio': 'kuaizi::speech-2.8-hd',
      },
    })
  })

  it('returns real configured model ids and keeps text creation compatible', async () => {
    installAuthMocks()
    mockAuthenticated('user-1')
    const route = await import('@/app/api/user/api-config/route')
    const response = await route.GET(buildMockRequest({ path: '/api/user/api-config', method: 'GET' }), context)
    const body = await response.json()
    expect(body.models.every((model: { provider: string; name: string; modelId: string }) => (
      model.provider === 'nori' && model.name === model.modelId
    ))).toBe(true)
    expect(body.models.some((model: { modelKey: string; name: string }) => model.modelKey === 'nori::nori-gpt' && model.name === 'deepseek-chat')).toBe(true)
    expect(body.defaultModels.analysisModel).toBe('nori::nori-gpt')
    expect(body.defaultModels.audioModel).toBe('')
    expect(JSON.stringify(body)).not.toContain('legacy-secret')
  })

  it('rejects provider and model writes', async () => {
    installAuthMocks()
    mockAuthenticated('user-1')
    const route = await import('@/app/api/user/api-config/route')
    const response = await route.PUT(buildMockRequest({ path: '/api/user/api-config', method: 'PUT', body: { providers: [{ id: 'ark', apiKey: 'legacy-secret' }] } }), context)
    expect(response.status).toBe(403)
    expect(prismaMock.userPreference.upsert).not.toHaveBeenCalled()
  })

  it('stores a valid text default without inventing a media price', async () => {
    installAuthMocks()
    mockAuthenticated('user-1')
    const route = await import('@/app/api/user/api-config/route')
    const response = await route.PUT(buildMockRequest({ path: '/api/user/api-config', method: 'PUT', body: { defaultModels: { analysisModel: 'nori::nori-gpt' }, workflowConcurrency: { analysis: 3 } } }), context)
    expect(response.status).toBe(200)
    expect(prismaMock.userPreference.upsert).toHaveBeenCalled()
  })

  it('rejects media models missing from the configured and priced catalog', async () => {
    installAuthMocks()
    mockAuthenticated('user-1')
    const route = await import('@/app/api/user/api-config/route')
    const response = await route.PUT(buildMockRequest({ path: '/api/user/api-config', method: 'PUT', body: { defaultModels: { videoModel: 'kuaizi::unpriced-video' }, workflowConcurrency: { analysis: 3 } } }), context)
    expect(response.status).toBe(400)
    expect(prismaMock.userPreference.upsert).not.toHaveBeenCalled()
  })

  it('stores a valid routed media default and concurrency without provider credentials', async () => {
    installAuthMocks()
    mockAuthenticated('user-1')
    const route = await import('@/app/api/user/api-config/route')
    const response = await route.PUT(buildMockRequest({ path: '/api/user/api-config', method: 'PUT', body: { defaultModels: { videoModel: 'nori::norivideo2.5' }, workflowConcurrency: { analysis: 3 } } }), context)
    expect(response.status).toBe(200)
    const call = prismaMock.userPreference.upsert.mock.calls[0][0]
    expect(call.update).toEqual({ videoModel: 'nori::norivideo2.5', analysisConcurrency: 3 })
  })

  it('rejects a disabled capability and a direct upstream default', async () => {
    installAuthMocks()
    mockAuthenticated('user-1')
    const route = await import('@/app/api/user/api-config/route')
    for (const videoModel of ['nori::nori-music', 'kuaizi::doubao-seedance-2-5-260628']) {
      const response = await route.PUT(buildMockRequest({ path: '/api/user/api-config', method: 'PUT', body: { defaultModels: { videoModel } } }), context)
      expect(response.status).toBe(400)
    }
    expect(prismaMock.userPreference.upsert).not.toHaveBeenCalled()
  })
})
