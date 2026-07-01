import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const createChatCompletionMock = vi.hoisted(() =>
  vi.fn(async () => ({
    id: 'chatcmpl_dev',
    object: 'chat.completion',
    created: 1,
    model: 'gpt-5.5',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: 'dev-ok' },
        finish_reason: 'stop',
      },
    ],
    usage: {
      prompt_tokens: 3,
      completion_tokens: 2,
      total_tokens: 5,
    },
  })),
)

const responsesFetchMock = vi.hoisted(() => vi.fn())

const openAiCtorMock = vi.hoisted(() =>
  vi.fn(() => ({
    chat: {
      completions: {
        create: createChatCompletionMock,
      },
    },
  })),
)

const resolveLlmRuntimeModelMock = vi.hoisted(() =>
  vi.fn(async () => {
    throw new Error('config center should not be called in dev text llm mode')
  }),
)

const logLlmRawInputMock = vi.hoisted(() => vi.fn())
const logLlmRawOutputMock = vi.hoisted(() => vi.fn())
const recordCompletionUsageMock = vi.hoisted(() => vi.fn())

vi.mock('openai', () => ({
  default: openAiCtorMock,
}))

vi.mock('@/lib/llm-observe/internal-stream-context', () => ({
  getInternalLLMStreamCallbacks: vi.fn(() => null),
}))

vi.mock('@/lib/llm/runtime-shared', () => ({
  _ulogError: vi.fn(),
  _ulogWarn: vi.fn(),
  completionUsageSummary: vi.fn(() => ({ promptTokens: 3, completionTokens: 2 })),
  isRetryableError: vi.fn(() => false),
  llmLogger: {
    info: vi.fn(),
    warn: vi.fn(),
  },
  logLlmRawInput: logLlmRawInputMock,
  logLlmRawOutput: logLlmRawOutputMock,
  recordCompletionUsage: recordCompletionUsageMock,
  resolveLlmRuntimeModel: resolveLlmRuntimeModelMock,
}))

import { chatCompletion } from '@/lib/llm/chat-completion'
import { chatCompletionStream } from '@/lib/llm/chat-stream'

describe('dev text llm runtime', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    responsesFetchMock.mockImplementation(async () => new Response(JSON.stringify({
      id: 'resp_dev',
      status: 'completed',
      model: 'gpt-5.5-2026-04-23',
      output: [
        {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'dev-ok' }],
        },
      ],
      usage: {
        input_tokens: 3,
        output_tokens: 2,
        total_tokens: 5,
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', responsesFetchMock)
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('DEV_TEXT_LLM_ENABLED', 'true')
    vi.stubEnv('DEV_TEXT_LLM_BASE_URL', 'http://localhost:8313/v1')
    vi.stubEnv('DEV_TEXT_LLM_API_KEY', 'dummy')
    vi.stubEnv('DEV_TEXT_LLM_MODEL', 'gpt-5.5')
    vi.stubEnv('DEV_TEXT_LLM_PROTOCOL', 'responses')
    vi.stubEnv('DEV_TEXT_LLM_STREAM', 'false')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('routes non-streaming text completions to local ghc-api responses without requiring configured model', async () => {
    const result = await chatCompletion(
      'user-1',
      null,
      [{ role: 'user', content: '你好' }],
      { temperature: 0.2, maxTokens: 200 },
    )

    expect(openAiCtorMock).not.toHaveBeenCalled()
    expect(responsesFetchMock).toHaveBeenCalledWith('http://localhost:8313/v1/responses', expect.objectContaining({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer dummy',
      },
    }))
    const requestInit = responsesFetchMock.mock.calls[0]?.[1] as RequestInit
    expect(JSON.parse(String(requestInit.body))).toEqual({
      model: 'gpt-5.5',
      input: [
        {
          role: 'user',
          content: [{ type: 'input_text', text: '你好' }],
        },
      ],
      max_output_tokens: 200,
    })
    expect(resolveLlmRuntimeModelMock).not.toHaveBeenCalled()
    expect(result.choices[0]?.message?.content).toBe('dev-ok')
    expect(recordCompletionUsageMock).toHaveBeenCalledWith('gpt-5.5', result)
  })

  it('routes streaming text completions through the same local ghc-api responses request by default', async () => {
    const onChunk = vi.fn()
    const onComplete = vi.fn()

    const result = await chatCompletionStream(
      'user-1',
      undefined,
      [{ role: 'user', content: '你好' }],
      { temperature: 0.3, maxTokens: 200 },
      { onChunk, onComplete },
    )

    expect(responsesFetchMock).toHaveBeenCalledWith('http://localhost:8313/v1/responses', expect.any(Object))
    expect(createChatCompletionMock).not.toHaveBeenCalled()
    expect(onChunk).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'text',
      delta: 'dev-ok',
      lane: 'main',
    }))
    expect(onComplete).toHaveBeenCalledWith('dev-ok', undefined)
    expect(result.choices[0]?.message?.content).toBe('dev-ok')
    expect(resolveLlmRuntimeModelMock).not.toHaveBeenCalled()
  })

  it('can opt into chat completions for chat-compatible ghc-api models', async () => {
    vi.stubEnv('DEV_TEXT_LLM_PROTOCOL', 'chat')
    vi.stubEnv('DEV_TEXT_LLM_MODEL', 'claude-opus-4.8')

    const result = await chatCompletion(
      'user-1',
      null,
      [{ role: 'user', content: '你好' }],
      { temperature: 0.2, maxTokens: 200 },
    )

    expect(responsesFetchMock).not.toHaveBeenCalled()
    expect(openAiCtorMock).toHaveBeenCalledWith({
      baseURL: 'http://localhost:8313/v1',
      apiKey: 'dummy',
    })
    expect(createChatCompletionMock).toHaveBeenCalledWith({
      model: 'claude-opus-4.8',
      messages: [{ role: 'user', content: '你好' }],
      temperature: 0.2,
      max_tokens: 200,
    })
    expect(result.choices[0]?.message?.content).toBe('dev-ok')
    expect(resolveLlmRuntimeModelMock).not.toHaveBeenCalled()
  })
})
