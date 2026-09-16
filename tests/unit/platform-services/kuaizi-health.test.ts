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
        id: 'kuaizi',
        name: 'Kuaizi',
        baseUrl: 'https://aiopenapi.kuaizi.cn',
        apiKey: 'test-key',
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

describe('kuaizi service health probe', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('checks the documented Seedance endpoint without creating a paid task', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      code: 'InvalidParameter',
      message: 'model is required',
    }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await probeProviderHealth('kuaizi', 'admin-1')
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit] | undefined
    if (!call) throw new Error('missing fetch call')

    expect(call[0]).toBe('https://aiopenapi.kuaizi.cn/ai-open-platform-api/api/v3/contents/generations/tasks')
    expect(call[1].method).toBe('POST')
    expect(call[1].headers).toEqual({ Authorization: 'Bearer test-key', 'Content-Type': 'application/json' })
    expect(call[1].headers).not.toHaveProperty('ApiKey')
    expect(result).toMatchObject({
      status: 'healthy',
      message: '连接正常，鉴权通过',
    })
    expect(persistMock).toHaveBeenCalledTimes(1)
    expect(recordUsageMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'success' }))
  })
})
