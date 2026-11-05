import { afterEach, describe, expect, it, vi } from 'vitest'

const persistMock = vi.hoisted(() => vi.fn(async () => ({})))
const recordUsageMock = vi.hoisted(() => vi.fn(async () => ({})))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    serviceHealthCheck: {
      create: persistMock,
      findMany: vi.fn(async () => []),
    },
  },
}))

vi.mock('@/lib/platform-services/config', () => ({
  isUsableServiceSecret: vi.fn(() => true),
  readMaterializedPlatformServiceConfig: vi.fn(() => ({
    llm: {
      providers: [{
        id: 'openlux',
        name: 'OpenLux API',
        baseUrl: 'https://api.openlux.ai/v1',
        apiKey: 'openlux-test-key',
      }],
    },
  })),
}))

vi.mock('@/lib/platform-services/usage', () => ({
  recordServiceUsage: recordUsageMock,
}))

vi.mock('@/lib/storage', () => ({
  deleteObject: vi.fn(),
  getObjectBuffer: vi.fn(),
  getSignedObjectUrl: vi.fn(),
  resetStorageProvider: vi.fn(),
  uploadObject: vi.fn(),
}))

import { probeProviderHealth } from '@/lib/platform-services/health'

describe('OpenLux service health probe', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('uses the read-only models endpoint and never submits a paid image request', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      data: [{ id: 'gpt-image-2.5-flare' }, { id: 'gpt-image-2.5-sunburst' }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await probeProviderHealth('openlux', 'admin-1')
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit] | undefined
    if (!call) throw new Error('missing fetch call')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(call[0]).toBe('https://api.openlux.ai/v1/models')
    expect(call[1].method).toBeUndefined()
    expect(call[1].headers).toEqual({ Authorization: 'Bearer openlux-test-key' })
    expect(call[0]).not.toContain('/images/')
    expect(result).toMatchObject({
      targetId: 'openlux',
      status: 'healthy',
      message: '连接正常，发现 2 个模型',
    })
    expect(persistMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        targetType: 'provider',
        targetId: 'openlux',
        status: 'healthy',
        details: expect.objectContaining({ probe: 'models' }),
      }),
    })
    expect(recordUsageMock).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'openlux',
      serviceType: 'image',
      operation: 'health-check',
      status: 'success',
    }))
  })
})
