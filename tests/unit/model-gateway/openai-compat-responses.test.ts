import { beforeEach, describe, expect, it, vi } from 'vitest'

const resolveOpenAICompatClientConfigMock = vi.hoisted(() =>
  vi.fn(async () => ({
    providerId: 'openai-compatible:node-1',
    baseUrl: 'https://compat.example.com/v1',
    apiKey: 'sk-test',
  })),
)

vi.mock('@/lib/model-gateway/openai-compat/common', () => ({
  resolveOpenAICompatClientConfig: resolveOpenAICompatClientConfigMock,
}))

import { runOpenAICompatResponsesCompletion } from '@/lib/model-gateway/openai-compat/responses'

describe('model-gateway openai-compat responses executor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('converts responses payload to normalized chat completion', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      output: [
        { type: 'reasoning', text: 'think-' },
        { type: 'output_text', text: 'hello' },
      ],
      usage: {
        input_tokens: 12,
        output_tokens: 7,
      },
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const completion = await runOpenAICompatResponsesCompletion({
      userId: 'user-1',
      providerId: 'openai-compatible:node-1',
      modelId: 'gpt-4.1-mini',
      messages: [{ role: 'user', content: 'hello' }],
      temperature: 0.2,
    })

    expect(completion.choices[0]?.message?.content).toEqual([
      { type: 'reasoning', text: 'think-' },
      { type: 'text', text: 'hello' },
    ])
    expect(completion.usage?.prompt_tokens).toBe(12)
    expect(completion.usage?.completion_tokens).toBe(7)
    const firstCall = fetchMock.mock.calls[0] as unknown[] | undefined
    expect(String(firstCall?.[0])).toBe('https://compat.example.com/v1/responses')
  })

  it('throws status-bearing error when responses endpoint fails', async () => {
    const fetchMock = vi.fn(async () => new Response('not supported', { status: 404 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      runOpenAICompatResponsesCompletion({
        userId: 'user-1',
        providerId: 'openai-compatible:node-1',
        modelId: 'gpt-4.1-mini',
        messages: [{ role: 'user', content: 'hello' }],
        temperature: 0.2,
      }),
    ).rejects.toThrow('OPENAI_COMPAT_RESPONSES_FAILED: 404')
  })

  it('retries once without temperature when the model rejects that parameter', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: {
          message: "Unsupported parameter: 'temperature' is not supported with this model.",
          code: 'invalid_request_body',
        },
      }), { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        output_text: 'ok',
        usage: { input_tokens: 3, output_tokens: 2 },
      }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const completion = await runOpenAICompatResponsesCompletion({
      userId: 'user-1',
      providerId: 'openai-compatible:node-1',
      modelId: 'nori-gpt-temperature-unsupported',
      messages: [{ role: 'user', content: 'hello' }],
      temperature: 0.2,
    })

    expect(completion.choices[0]?.message?.content).toBe('ok')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const firstBody = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.body))
    const secondBody = JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit | undefined)?.body))
    expect(firstBody.temperature).toBe(0.2)
    expect(secondBody).not.toHaveProperty('temperature')
  })

  it('remembers that a provider model does not support temperature', async () => {
    const unsupported = new Response(JSON.stringify({
      error: { message: 'temperature is not supported with this model' },
    }), { status: 400 })
    const success = () => new Response(JSON.stringify({
      output_text: 'cached capability',
      usage: { input_tokens: 1, output_tokens: 1 },
    }), { status: 200 })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(unsupported)
      .mockResolvedValueOnce(success())
    vi.stubGlobal('fetch', fetchMock)

    await runOpenAICompatResponsesCompletion({
      userId: 'user-1',
      providerId: 'openai-compatible:node-1',
      modelId: 'nori-gpt-capability-cache',
      messages: [{ role: 'user', content: 'learn capability' }],
      temperature: 0.2,
    })

    fetchMock.mockClear()
    fetchMock.mockResolvedValueOnce(success())
    await runOpenAICompatResponsesCompletion({
      userId: 'user-1',
      providerId: 'openai-compatible:node-1',
      modelId: 'nori-gpt-capability-cache',
      messages: [{ role: 'user', content: 'hello again' }],
      temperature: 0.2,
    })

    const body = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.body))
    expect(body).not.toHaveProperty('temperature')
  })
})
