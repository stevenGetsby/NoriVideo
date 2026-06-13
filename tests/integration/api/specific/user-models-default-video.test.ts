import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../../helpers/request'

const authMock = vi.hoisted(() => ({
  requireUserAuth: vi.fn(async () => ({
    session: { user: { id: 'user-1' } },
  })),
  isErrorResponse: vi.fn((value: unknown) => value instanceof Response),
}))

const prismaMock = vi.hoisted(() => ({
  userPreference: {
    findUnique: vi.fn(),
  },
}))

vi.mock('@/lib/api-auth', () => authMock)
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/model-capabilities/catalog', () => ({
  findBuiltinCapabilities: vi.fn(() => undefined),
}))
vi.mock('@/lib/model-pricing/catalog', () => ({
  findBuiltinPricingCatalogEntry: vi.fn(() => undefined),
}))

describe('api specific - user models default video', () => {
  const routeContext = { params: Promise.resolve({}) }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('exposes default video model even when it is not duplicated in customModels', async () => {
    prismaMock.userPreference.findUnique.mockResolvedValue({
      customModels: JSON.stringify([]),
      customProviders: JSON.stringify([
        {
          id: 'ark',
          name: 'Volcengine Ark',
          apiKey: 'k-ark',
        },
      ]),
      videoModel: 'ark::doubao-seedance-1-0-pro-fast-251015',
    })

    const mod = await import('@/app/api/user/models/route')
    const req = buildMockRequest({
      path: '/api/user/models',
      method: 'GET',
    })

    const res = await mod.GET(req, routeContext)
    const body = await res.json() as { video: Array<{ value: string; providerName?: string }> }

    expect(res.status).toBe(200)
    expect(body.video).toEqual([
      {
        value: 'ark::doubao-seedance-1-0-pro-fast-251015',
        label: 'doubao-seedance-1-0-pro-fast-251015',
        provider: 'ark',
        providerName: 'Volcengine Ark',
      },
    ])
  })

  it('does not expose default video model when its provider has no api key', async () => {
    prismaMock.userPreference.findUnique.mockResolvedValue({
      customModels: JSON.stringify([]),
      customProviders: JSON.stringify([
        {
          id: 'ark',
          name: 'Volcengine Ark',
        },
      ]),
      videoModel: 'ark::doubao-seedance-1-0-pro-fast-251015',
    })

    const mod = await import('@/app/api/user/models/route')
    const req = buildMockRequest({
      path: '/api/user/models',
      method: 'GET',
    })

    const res = await mod.GET(req, routeContext)
    const body = await res.json() as { video: Array<{ value: string }> }

    expect(res.status).toBe(200)
    expect(body.video).toEqual([])
  })
})
