import { beforeEach, describe, expect, it, vi } from 'vitest'

const pollKuaiziTaskMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/providers/kuaizi/poll', () => ({
  pollKuaiziTask: pollKuaiziTaskMock,
}))

import { formatExternalId, parseExternalId, pollAsyncTask } from '@/lib/async-poll'

describe('Kuaizi-only async task recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn())
  })

  it('round-trips durable Kuaizi image, video and audio ids', () => {
    for (const type of ['IMAGE', 'VIDEO', 'AUDIO'] as const) {
      const externalId = formatExternalId('KUAIZI', type, 'request:1', undefined, 'provider-token', 'model-token')
      expect(externalId).toBe(`KUAIZI:${type}:provider-token:model-token:request:1`)
      expect(parseExternalId(externalId)).toEqual({
        provider: 'KUAIZI',
        type,
        providerToken: 'provider-token',
        modelKeyToken: 'model-token',
        requestId: 'request:1',
      })
    }
  })

  it('resumes only the Kuaizi poller with its durable routing tokens', async () => {
    pollKuaiziTaskMock.mockResolvedValueOnce({ status: 'pending' })
    await expect(pollAsyncTask(
      'KUAIZI:VIDEO:provider-token:model-token:task-1',
      'user-1',
    )).resolves.toEqual({ status: 'pending' })
    expect(pollKuaiziTaskMock).toHaveBeenCalledWith({
      type: 'VIDEO',
      taskId: 'task-1',
      userId: 'user-1',
      providerToken: 'provider-token',
      modelToken: 'model-token',
    })
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([
    'FAL:VIDEO:fal-ai/wan/v2.6/image-to-video:req_123',
    'ARK:VIDEO:task-1',
    'BAILIAN:VIDEO:task-1',
    'SILICONFLOW:IMAGE:task-1',
    'OPENAI:VIDEO:provider-token:task-1',
    'OCOMPAT:VIDEO:provider-token:model-token:task-1',
    'GOOGLE:VIDEO:operation-1',
    'MINIMAX:AUDIO:task-1',
    'batches/legacy',
    'KUAIZI:VIDEO:missing-tokens',
  ])('rejects retired or malformed task id %s without network access', async (externalId) => {
    await expect(pollAsyncTask(externalId, 'user-1')).rejects.toThrow('ASYNC_TASK_PROVIDER_RETIRED')
    expect(pollKuaiziTaskMock).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('does not format external ids without Kuaizi routing tokens', () => {
    expect(() => formatExternalId('KUAIZI', 'VIDEO', 'task-1')).toThrow('ASYNC_TASK_PROVIDER_RETIRED')
  })
})
