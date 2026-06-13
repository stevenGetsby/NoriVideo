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
    findUnique: vi.fn(async () => ({
      customModels: JSON.stringify([
        {
          modelId: 'gpt-5.5',
          modelKey: 'anthropic-compatible:lumina-test::gpt-5.5',
          name: 'GPT-5.5',
          type: 'llm',
          provider: 'anthropic-compatible:lumina-test',
        },
        {
          modelId: 'gemini-3-pro-preview',
          modelKey: 'anthropic-compatible:lumina-test::gemini-3-pro-preview',
          name: 'Gemini 3 Pro',
          type: 'llm',
          provider: 'anthropic-compatible:lumina-test',
        },
        {
          modelId: 'claude-sonnet-4-6',
          modelKey: 'anthropic-compatible:lumina-test::claude-sonnet-4-6',
          name: 'Claude Sonnet 4.6',
          type: 'llm',
          provider: 'anthropic-compatible:lumina-test',
        },
      ]),
      customProviders: JSON.stringify([
        {
          id: 'anthropic-compatible:lumina-test',
          name: 'Lumina Test',
          apiKey: 'k-lumina',
        },
      ]),
    })),
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

describe('api specific - user models vision group', () => {
  const routeContext = { params: Promise.resolve({}) }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('keeps Lumina GPT/Gemini image-understanding models separate without removing them from llm', async () => {
    const mod = await import('@/app/api/user/models/route')
    const req = buildMockRequest({
      path: '/api/user/models',
      method: 'GET',
    })
    const res = await mod.GET(req, routeContext)

    expect(res.status).toBe(200)
    const body = await res.json() as {
      llm: Array<{ value: string; label: string }>
      vision: Array<{ value: string; label: string }>
    }

    expect(body.llm.map((item) => item.label)).toEqual([
      'GPT-5.5',
      'Gemini 3 Pro',
      'Claude Sonnet 4.6',
    ])
    expect(body.vision.map((item) => item.label)).toEqual([
      'GPT-5.5',
      'Gemini 3 Pro',
    ])
  })
})
