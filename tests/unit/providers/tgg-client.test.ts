import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildTggUrl,
  requestTgg,
  TGG_DEFAULT_BASE_URL,
} from '@/lib/providers/tgg/client'

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('tgg http client', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('builds urls on the official base without a /v1 suffix and passes absolute urls through', () => {
    expect(buildTggUrl(undefined, '/v1/videos')).toBe('https://tggtoken.org/v1/videos')
    expect(buildTggUrl('https://tggtoken.org/', 'v1/videos')).toBe('https://tggtoken.org/v1/videos')
    expect(buildTggUrl('https://tggtoken.org///', '/v1/models')).toBe('https://tggtoken.org/v1/models')
    expect(buildTggUrl(undefined, 'https://cdn.example/content.mp4?sig=a')).toBe('https://cdn.example/content.mp4?sig=a')
    expect(TGG_DEFAULT_BASE_URL).toBe('https://tggtoken.org')
  })

  it('sends bearer auth and a json body exactly once', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'task-1' }))
    const payload = await requestTgg({
      apiKey: 'tgg-test-secret-value',
      path: '/v1/videos',
      method: 'POST',
      body: { model: 'tgg-fixture-video', prompt: 'pan', seconds: 5 },
    })

    expect(payload).toEqual({ id: 'task-1' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://tggtoken.org/v1/videos')
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer tgg-test-secret-value',
      'Content-Type': 'application/json',
    })
    expect(JSON.parse(String(init.body))).toEqual({ model: 'tgg-fixture-video', prompt: 'pan', seconds: 5 })
  })

  it('never retries a failed creation: network errors become TGG_SUBMIT_UNCONFIRMED', async () => {
    fetchMock.mockRejectedValueOnce(new Error('socket hang up'))
    await expect(requestTgg({
      apiKey: 'tgg-test-secret-value',
      path: '/v1/videos',
      method: 'POST',
      body: { model: 'tgg-fixture-video', prompt: 'pan', seconds: 5 },
    })).rejects.toThrow('TGG_SUBMIT_UNCONFIRMED')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('surfaces query network errors without the submit marker', async () => {
    fetchMock.mockRejectedValueOnce(new Error('timeout of 30000ms exceeded'))
    await expect(requestTgg({
      apiKey: 'tgg-test-secret-value',
      path: '/v1/videos/task-1',
      method: 'GET',
    })).rejects.toThrow('timeout of 30000ms exceeded')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('maps rate limit and quota errors to dedicated codes', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: { message: 'rate limit exceeded' } }, 429))
    await expect(requestTgg({ apiKey: 'k', path: '/v1/videos', method: 'POST', body: {} }))
      .rejects.toThrow('TGG_RATE_LIMITED: rate limit exceeded')

    fetchMock.mockResolvedValueOnce(jsonResponse({ error: { message: '账户额度不足' } }, 402))
    await expect(requestTgg({ apiKey: 'k', path: '/v1/videos', method: 'POST', body: {} }))
      .rejects.toThrow('TGG_QUOTA_INSUFFICIENT: 账户额度不足')

    fetchMock.mockResolvedValueOnce(jsonResponse({ error: { message: 'quota exhausted' } }, 403))
    await expect(requestTgg({ apiKey: 'k', path: '/v1/videos', method: 'POST', body: {} }))
      .rejects.toThrow('TGG_QUOTA_INSUFFICIENT: quota exhausted')

    fetchMock.mockResolvedValueOnce(jsonResponse({ error: { message: 'forbidden' } }, 403))
    await expect(requestTgg({ apiKey: 'k', path: '/v1/videos', method: 'POST', body: {} }))
      .rejects.toThrow('TGG_HTTP_ERROR(403): forbidden')
  })

  it('keeps the http status for generic errors and rejects invalid json', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: { message: 'upstream exploded' } }, 500))
    await expect(requestTgg({ apiKey: 'k', path: '/v1/models', method: 'GET' }))
      .rejects.toThrow('TGG_HTTP_ERROR(500): upstream exploded')

    fetchMock.mockResolvedValueOnce(new Response('<html>bad gateway</html>', { status: 502 }))
    await expect(requestTgg({ apiKey: 'k', path: '/v1/models', method: 'GET' }))
      .rejects.toThrow('TGG_RESPONSE_INVALID_JSON: HTTP 502')
  })

  it('sanitizes credentials and signed url parameters out of provider messages', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      error: { message: 'download failed https://cdn.example/a.mp4?X-Tos-Signature=secret Authorization: Bearer sk-live-abcdef123456' },
    }, 400))
    let message = ''
    try {
      await requestTgg({ apiKey: 'k', path: '/v1/videos/task-1', method: 'GET' })
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }
    expect(message).toContain('TGG_HTTP_ERROR(400)')
    expect(message).toContain('[已隐藏访问参数]')
    expect(message).toContain('Bearer [已隐藏密钥]')
    expect(message).not.toContain('X-Tos-Signature=secret')
    expect(message).not.toContain('sk-live-abcdef123456')
  })
})
