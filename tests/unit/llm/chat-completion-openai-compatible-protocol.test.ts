import { beforeEach, describe, expect, it, vi } from 'vitest'

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

const runOpenAICompatChatCompletionMock = vi.hoisted(() =>
  vi.fn(async () => ({
    id: 'chatcmpl_chat_1',
    object: 'chat.completion',
    created: 1,
    model: 'deepseek-chat',
    choices: [{ index: 0, message: { role: 'assistant', content: 'chat-ok' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  })),
)

const getProviderConfigMock = vi.hoisted(() =>
  vi.fn(async () => ({
    id: 'deepseek',
    name: 'DeepSeek',
    apiKey: 'sk-test',
    baseUrl: 'https://api.deepseek.com/v1',
  })),
)

const logLlmRawInputMock = vi.hoisted(() => vi.fn())
const logLlmRawOutputMock = vi.hoisted(() => vi.fn())
const recordCompletionUsageMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/llm-observe/internal-stream-context', () => ({
  getInternalLLMStreamCallbacks: vi.fn(() => null),
}))

vi.mock('@/lib/model-gateway', () => ({
  resolveModelGatewayRoute: vi.fn(() => 'openai-compat'),
  runOpenAICompatChatCompletion: runOpenAICompatChatCompletionMock,
}))

vi.mock('@/lib/api-config', () => ({
  getProviderConfig: getProviderConfigMock,
  getProviderKey: vi.fn((providerId: string) => providerId.split(':')[0] || providerId),
}))

vi.mock('@/lib/llm/runtime-shared', () => ({
  _ulogError: vi.fn(),
  _ulogWarn: vi.fn(),
  completionUsageSummary: vi.fn(() => ({ promptTokens: 1, completionTokens: 1 })),
  isRetryableError: vi.fn(() => false),
  llmLogger: {
    info: vi.fn(),
    warn: vi.fn(),
  },
  logLlmRawInput: logLlmRawInputMock,
  logLlmRawOutput: logLlmRawOutputMock,
  recordCompletionUsage: recordCompletionUsageMock,
  recordFailedCompletionUsage: vi.fn(async () => undefined),
  resolveLlmRuntimeModel: resolveLlmRuntimeModelMock,
}))

import { chatCompletion } from '@/lib/llm/chat-completion'

describe('llm chatCompletion DeepSeek-only text routing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses chat-completions executor when llmProtocol=chat-completions', async () => {
    resolveLlmRuntimeModelMock.mockResolvedValueOnce({
      provider: 'deepseek',
      modelId: 'deepseek-chat',
      modelKey: 'deepseek::deepseek-chat',
      llmProtocol: 'chat-completions',
    })

    const completion = await chatCompletion(
      'user-1',
      'deepseek::deepseek-chat',
      [{ role: 'user', content: 'hello' }],
      { temperature: 0.2 },
    )

    expect(runOpenAICompatChatCompletionMock).toHaveBeenCalledTimes(1)
    expect(completion.choices[0]?.message?.content).toBe('chat-ok')
  })

  it('rejects retired providers without reading their credentials', async () => {
    resolveLlmRuntimeModelMock.mockResolvedValueOnce({
      provider: 'bailian',
      modelId: 'qwen3.5-flash',
      modelKey: 'bailian::qwen3.5-flash',
      llmProtocol: 'chat-completions',
    })
    const call = () => chatCompletion('user-1', 'bailian::qwen3.5-flash', [{ role: 'user', content: 'hello' }], {})
    await expect(call()).rejects.toThrow('TEXT_PROVIDER_UNSUPPORTED')
    expect(getProviderConfigMock).not.toHaveBeenCalled()
    expect(runOpenAICompatChatCompletionMock).not.toHaveBeenCalled()
  })
})
