import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  postKuaiziApiKey,
  requestKuaiziBearer,
} from '@/lib/providers/kuaizi/client'

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function requestInit(fetchMock: ReturnType<typeof vi.fn>): RequestInit {
  const call = fetchMock.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit] | undefined
  if (!call) throw new Error('missing fetch call')
  return call[1]
}

describe('kuaizi HTTP client authentication', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uses only the ApiKey header for regular OpenAPI requests', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ code: 0, data: { task_id: 'task-1' } }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(postKuaiziApiKey({
      apiKey: 'kuaizi-test-key',
      path: '/ai-open-platform-api/v1/seedream/image/task/create',
      body: { model: 'seedream5.0lite', prompt: 'test' },
    })).resolves.toEqual({ task_id: 'task-1' })

    const init = requestInit(fetchMock)
    expect(init.headers).toEqual({
      ApiKey: 'kuaizi-test-key',
      'Content-Type': 'application/json',
    })
    expect(init.headers).not.toHaveProperty('Authorization')
  })

  it('uses Bearer only for the Seedance Ark-compatible API', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ id: 'task-2' }))
    vi.stubGlobal('fetch', fetchMock)

    await requestKuaiziBearer({
      apiKey: 'kuaizi-test-key',
      path: '/ai-open-platform-api/api/v3/contents/generations/tasks',
      method: 'POST',
      body: { model: 'doubao-seedance-2-0-260128', content: [] },
    })

    const init = requestInit(fetchMock)
    expect(init.headers).toEqual({
      Authorization: 'Bearer kuaizi-test-key',
      'Content-Type': 'application/json',
    })
    expect(init.headers).not.toHaveProperty('ApiKey')
  })
})
