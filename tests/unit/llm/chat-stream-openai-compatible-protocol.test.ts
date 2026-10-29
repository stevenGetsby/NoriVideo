import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatCompletionStreamCallbacks } from '@/lib/llm/types'

type MockRuntimeModel = {
  provider: string
  modelId: string
  modelKey: string
  llmProtocol: 'chat-completions' | undefined
}

const resolveLlmRuntimeModelMock = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<MockRuntimeModel>>(async () => ({
    provider: 'deepseek',
    modelId: 'deepseek-chat',
    modelKey: 'deepseek::deepseek-chat',
    llmProtocol: 'chat-completions',
  })),
)
const createChatCompletionMock = vi.hoisted(() => vi.fn())
const getProviderConfigMock = vi.hoisted(() => vi.fn(async () => ({
  id: 'deepseek', name: 'DeepSeek', apiKey: 'sk-test',
})))
const logLlmRawOutputMock = vi.hoisted(() => vi.fn())
const recordCompletionUsageMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/model-gateway/openai-compat/common', () => ({
  resolveOpenAICompatClientConfig: vi.fn(async () => ({
    providerId: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'sk-test',
  })),
  createOpenAICompatClient: vi.fn(() => ({
    chat: { completions: { create: createChatCompletionMock } },
  })),
}))
vi.mock('@/lib/api-config', () => ({
  getProviderConfig: getProviderConfigMock,
  getProviderKey: vi.fn((providerId: string) => providerId.split(':')[0] || providerId),
}))
vi.mock('@/lib/llm/runtime-shared', () => ({
  completionUsageSummary: vi.fn((completion: { usage?: unknown }) => completion.usage),
  logLlmRawInput: vi.fn(),
  logLlmRawOutput: logLlmRawOutputMock,
  recordCompletionUsage: recordCompletionUsageMock,
  recordFailedCompletionUsage: vi.fn(async () => undefined),
  resolveLlmRuntimeModel: resolveLlmRuntimeModelMock,
}))

import { chatCompletionStream } from '@/lib/llm/chat-stream'

function streamOf(chunks: unknown[], finalCompletion?: unknown) {
  return {
    async *[Symbol.asyncIterator]() { yield* chunks },
    ...(finalCompletion ? { finalChatCompletion: async () => finalCompletion } : {}),
  }
}

function textDelta(content: string) {
  return { choices: [{ delta: { content } }] }
}

describe('DeepSeek chat completion streaming', () => {
  beforeEach(() => vi.clearAllMocks())

  it('forwards real deltas with caller step metadata and one lifecycle', async () => {
    const usage = { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 }
    createChatCompletionMock.mockResolvedValueOnce(streamOf([
      { choices: [{ delta: { reasoning_content: 'Think ' } }] },
      { choices: [{ delta: { reasoning_content: 'first.' } }] },
      textDelta('Hello '), textDelta('world.'),
      { choices: [], usage },
    ], {
      id: 'chatcmpl_stream', object: 'chat.completion', created: 1, model: 'deepseek-chat',
      choices: [{ index: 0, message: { role: 'assistant', content: 'Hello world.' }, finish_reason: 'stop' }],
      usage,
    }))
    const chunks: Array<Record<string, unknown>> = []
    const stages: string[] = []
    const completed = vi.fn()
    const callbacks: ChatCompletionStreamCallbacks = {
      onStage: ({ stage }) => stages.push(stage),
      onChunk: (chunk) => chunks.push(chunk),
      onComplete: completed,
    }
    const completion = await chatCompletionStream(
      'user-1', 'nori::nori-gemini', [{ role: 'user', content: 'hello' }],
      { streamStepId: 'step-1', streamStepAttempt: 2, streamStepIndex: 1, streamStepTotal: 3 },
      callbacks,
    )

    expect(chunks.map(({ kind, delta }) => [kind, delta])).toEqual([
      ['reasoning', 'Think '], ['reasoning', 'first.'], ['text', 'Hello '], ['text', 'world.'],
    ])
    expect(chunks.every((chunk) => (chunk.step as { id: string }).id === 'step-1')).toBe(true)
    expect(chunks.every((chunk) => (chunk.step as { attempt: number }).attempt === 2)).toBe(true)
    expect(stages).toEqual(['submit', 'streaming', 'completed'])
    expect(completed).toHaveBeenCalledOnce()
    expect(completed).toHaveBeenCalledWith('Hello world.', expect.objectContaining({ id: 'step-1' }))
    expect(createChatCompletionMock).toHaveBeenCalledWith(expect.objectContaining({
      stream: true, stream_options: { include_usage: true },
    }))
    expect(completion.usage).toEqual(usage)
    expect(recordCompletionUsageMock).toHaveBeenCalledOnce()
    expect(logLlmRawOutputMock).toHaveBeenCalledWith(expect.objectContaining({
      text: 'Hello world.', reasoning: 'Think first.', stream: true,
    }))
  })

  it('builds a completion without losing reasoning or stream usage', async () => {
    const usage = { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 }
    createChatCompletionMock.mockResolvedValueOnce(streamOf([
      { choices: [{ delta: { reasoning_content: 'Reason.' } }] },
      textDelta('Answer.'), { choices: [], usage },
    ]))

    const completion = await chatCompletionStream(
      'user-1', 'nori::nori-gemini', [{ role: 'user', content: 'hello' }],
    )

    expect(completion.choices[0]?.message.content).toEqual([
      { type: 'reasoning', text: 'Reason.' }, { type: 'text', text: 'Answer.' },
    ])
    expect(completion.usage).toEqual(usage)
  })

  it('rejects retired providers before credentials or network access', async () => {
    resolveLlmRuntimeModelMock.mockResolvedValueOnce({
      provider: 'bailian', modelId: 'qwen3.5-flash',
      modelKey: 'bailian::qwen3.5-flash', llmProtocol: 'chat-completions',
    })

    await expect(chatCompletionStream(
      'user-1', 'bailian::qwen3.5-flash', [{ role: 'user', content: 'hello' }],
    )).rejects.toThrow('TEXT_PROVIDER_UNSUPPORTED')
    expect(getProviderConfigMock).not.toHaveBeenCalled()
    expect(createChatCompletionMock).not.toHaveBeenCalled()
  })
})
