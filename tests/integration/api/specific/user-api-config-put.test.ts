import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../../helpers/request'
import { installAuthMocks, mockAuthenticated, resetAuthMockState } from '../../../helpers/auth'

const prismaMock = vi.hoisted(() => ({ userPreference: { findUnique: vi.fn(), upsert: vi.fn() } }))
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
const context = { params: Promise.resolve({}) }

describe('platform-controlled user API config', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    resetAuthMockState()
    prismaMock.userPreference.findUnique.mockResolvedValue({ analysisModel: 'hfsy::legacy', analysisConcurrency: 3 })
    prismaMock.userPreference.upsert.mockResolvedValue({})
  })

  it('returns only DeepSeek/Kuaizi and clears legacy defaults', async () => {
    installAuthMocks()
    mockAuthenticated('user-1')
    const route = await import('@/app/api/user/api-config/route')
    const response = await route.GET(buildMockRequest({ path: '/api/user/api-config', method: 'GET' }), context)
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.providers.map((provider: { id: string }) => provider.id)).toEqual(['deepseek', 'kuaizi'])
    expect(body.models.every((model: { provider: string }) => ['deepseek', 'kuaizi'].includes(model.provider))).toBe(true)
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

  it('stores a valid platform default and concurrency without provider credentials', async () => {
    installAuthMocks()
    mockAuthenticated('user-1')
    const route = await import('@/app/api/user/api-config/route')
    const response = await route.PUT(buildMockRequest({ path: '/api/user/api-config', method: 'PUT', body: { defaultModels: { analysisModel: 'deepseek::deepseek-chat' }, workflowConcurrency: { analysis: 3 } } }), context)
    expect(response.status).toBe(200)
    const call = prismaMock.userPreference.upsert.mock.calls[0][0]
    expect(call.update).toEqual({ analysisModel: 'deepseek::deepseek-chat', analysisConcurrency: 3 })
  })
})
