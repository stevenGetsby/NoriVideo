import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../../helpers/request'

vi.mock('@/lib/api-auth', () => ({
  requireUserAuth: vi.fn(async () => ({ session: { user: { id: 'user-1' } } })),
  isErrorResponse: vi.fn((value: unknown) => value instanceof Response),
}))
const configMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/platform-services/config', () => ({ getPlatformServiceConfigResponse: configMock }))

describe('api specific - user models default video', () => {
  const routeContext = { params: Promise.resolve({}) }

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    configMock.mockReturnValue({
      providers: [
        { id: 'kuaizi', name: 'Kuaizi', hasApiKey: true },
        { id: 'openlux', name: 'OpenLux', hasApiKey: false },
      ],
      models: [
        {
          provider: 'kuaizi',
          modelId: 'doubao-seedance-2-5-260628',
          modelKey: 'kuaizi::doubao-seedance-2-5-260628',
          name: 'Packaged video alias',
          type: 'video',
        },
        {
          provider: 'openlux',
          modelId: 'gpt-image-2.5-sunburst',
          modelKey: 'openlux::gpt-image-2.5-sunburst',
          name: 'Packaged image alias',
          type: 'image',
        },
      ],
    })
  })

  it('exposes the configured video model by its real id without provider or tiers', async () => {
    const mod = await import('@/app/api/user/models/route')
    const res = await mod.GET(buildMockRequest({ path: '/api/user/models', method: 'GET' }), routeContext)
    const body = await res.json() as { video: Array<Record<string, unknown>> }

    expect(res.status).toBe(200)
    expect(body.video).toHaveLength(1)
    expect(body.video[0]).toMatchObject({
      value: 'kuaizi::doubao-seedance-2-5-260628',
      label: 'doubao-seedance-2-5-260628',
    })
    expect(body.video[0]).not.toHaveProperty('providerName')
    expect(body.video[0]).not.toHaveProperty('tier')
    expect(JSON.stringify(body.video)).not.toMatch(/LanMiaoTV|norivideo|Packaged| · (?:Mini|Fast|标准|Pro)/i)
  })

  it('hides unconfigured media providers without exposing their credentials', async () => {
    const mod = await import('@/app/api/user/models/route')
    const res = await mod.GET(buildMockRequest({ path: '/api/user/models', method: 'GET' }), routeContext)
    const body = await res.json() as { image: unknown[]; video: Array<Record<string, unknown>> }

    expect(res.status).toBe(200)
    expect(body.image).toEqual([])
    expect(body.video).toHaveLength(1)
    expect(JSON.stringify(body)).not.toContain('apiKey')
  })
})
