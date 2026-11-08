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
      defaultModels: { analysisModel: 'deepseek::deepseek-chat' },
    })
  })

  it('returns real configured model ids and keeps text creation compatible', async () => {
    installAuthMocks()
    mockAuthenticated('user-1')
    const route = await import('@/app/api/user/api-config/route')
    const response = await route.GET(buildMockRequest({ path: '/api/user/api-config', method: 'GET' }), context)
    const body = await response.json()
    const providerIds = ['deepseek', 'openlux', 'kuaizi', 'huimengi']
    expect(response.status).toBe(200)
    expect(body.providers.map((provider: { id: string }) => provider.id)).toEqual(providerIds)
    expect(body.models.every((model: { provider: string; name: string; modelId: string }) => (
      providerIds.includes(model.provider) && model.name === model.modelId
    ))).toBe(true)
    expect(body.models.some((model: { modelKey: string; name: string }) => model.modelKey === 'deepseek::deepseek-chat' && model.name === 'deepseek-chat')).toBe(true)
    expect(body.defaultModels.analysisModel).toBe('deepseek::deepseek-chat')
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
    const response = await route.PUT(buildMockRequest({ path: '/api/user/api-config', method: 'PUT', body: { defaultModels: { analysisModel: 'deepseek::deepseek-chat' }, workflowConcurrency: { analysis: 3 } } }), context)
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

  it('stores a valid priced media default and concurrency without provider credentials', async () => {
    installAuthMocks()
    mockAuthenticated('user-1')
    const route = await import('@/app/api/user/api-config/route')
    const response = await route.PUT(buildMockRequest({ path: '/api/user/api-config', method: 'PUT', body: { defaultModels: { videoModel: 'kuaizi::doubao-seedance-2-5-260628' }, workflowConcurrency: { analysis: 3 } } }), context)
    expect(response.status).toBe(200)
    const call = prismaMock.userPreference.upsert.mock.calls[0][0]
    expect(call.update).toEqual({ videoModel: 'kuaizi::doubao-seedance-2-5-260628', analysisConcurrency: 3 })
  })
})
