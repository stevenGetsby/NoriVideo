import { beforeEach, describe, expect, it, vi } from 'vitest'

const getProviderConfigMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api-config', () => ({ getProviderConfig: getProviderConfigMock }))

import { pollTggTask, queryTggTaskStatus } from '@/lib/providers/tgg/poll'
import { encodeTggExternalToken } from '@/lib/providers/tgg/external-id'

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('tgg task polling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getProviderConfigMock.mockResolvedValue({ apiKey: 'tgg-test-secret-value', baseUrl: 'https://tggtoken.org' })
  })

  it('maps queued and in_progress to pending without a result', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: 'queued', progress: 0 }))
    expect(await queryTggTaskStatus({ taskId: 'task-1', apiKey: 'tgg-test-secret-value' })).toEqual({ status: 'pending' })

    fetchMock.mockResolvedValueOnce(jsonResponse({ status: 'in_progress', progress: 42 }))
    expect(await queryTggTaskStatus({ taskId: 'task-1', apiKey: 'tgg-test-secret-value' })).toEqual({ status: 'pending' })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://tggtoken.org/v1/videos/task-1')
    expect(init.method).toBe('GET')
    expect(init.headers).toMatchObject({ Authorization: 'Bearer tgg-test-secret-value' })
  })

  it('returns the bearer-protected content url and provider metadata on completion', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      status: 'completed',
      content_url: '/v1/videos/task-1/content',
      seconds: 5,
      resolution: '720p',
      ratio: '16:9',
    }))
    const result = await queryTggTaskStatus({ taskId: 'task-1', apiKey: 'tgg-test-secret-value' })
    expect(result).toEqual({
      status: 'completed',
      resultUrl: 'https://tggtoken.org/v1/videos/task-1/content',
      videoUrl: 'https://tggtoken.org/v1/videos/task-1/content',
      downloadHeaders: { Authorization: 'Bearer tgg-test-secret-value' },
      durationSeconds: 5,
      resolution: '720p',
      aspectRatio: '16:9',
    })
    expect(result.actualVideoTokens).toBeUndefined()
  })

  it('falls back to the default content path and passes absolute content urls through', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: 'completed' }))
    const fallback = await queryTggTaskStatus({ taskId: 'task-1', apiKey: 'k' })
    expect(fallback.resultUrl).toBe('https://tggtoken.org/v1/videos/task-1/content')

    fetchMock.mockResolvedValueOnce(jsonResponse({ status: 'completed', content_url: 'https://cdn.example/out.mp4' }))
    const absolute = await queryTggTaskStatus({ taskId: 'task-1', apiKey: 'k', baseUrl: 'https://tggtoken.org/' })
    expect(absolute.resultUrl).toBe('https://cdn.example/out.mp4')
  })

  it('treats delivery failure as terminal without recreating the task', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: 'completed', delivery_status: 'failed' }))
    expect(await queryTggTaskStatus({ taskId: 'task-1', apiKey: 'k' })).toEqual({
      status: 'failed',
      error: 'TGG_DELIVERY_FAILED',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('sanitizes upstream failure messages', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      status: 'failed',
      error: { message: 'content policy violation https://cdn.example/ref.png?X-Tos-Signature=secret' },
    }))
    const result = await queryTggTaskStatus({ taskId: 'task-1', apiKey: 'k' })
    expect(result.status).toBe('failed')
    expect(result.error).toContain('content policy violation')
    expect(result.error).toContain('[已隐藏访问参数]')
    expect(result.error).not.toContain('X-Tos-Signature=secret')
  })

  it('fails closed on invalid payloads and network errors', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(['not', 'an', 'object']))
    expect((await queryTggTaskStatus({ taskId: 'task-1', apiKey: 'k' })).status).toBe('failed')

    fetchMock.mockRejectedValueOnce(new Error('socket hang up'))
    const network = await queryTggTaskStatus({ taskId: 'task-1', apiKey: 'k' })
    expect(network.status).toBe('failed')
    expect(network.error).toBeTruthy()
  })

  it('resumes through the pinned provider token and scoped config', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: 'completed', content_url: '/v1/videos/task-9/content' }))
    const result = await pollTggTask({
      type: 'VIDEO',
      taskId: 'task-9',
      userId: 'user-1',
      providerToken: encodeTggExternalToken('tgg:production'),
      modelToken: encodeTggExternalToken('tgg-fixture-video'),
    })
    expect(getProviderConfigMock).toHaveBeenCalledWith('user-1', 'tgg:production')
    expect(result.status).toBe('completed')
    expect(result.resultUrl).toBe('https://tggtoken.org/v1/videos/task-9/content')
  })
})
