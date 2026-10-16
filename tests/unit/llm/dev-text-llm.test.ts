import { afterEach, describe, expect, it, vi } from 'vitest'

const runtime = vi.hoisted(() => ({ resolve: vi.fn(), failures: vi.fn(async () => undefined) }))
vi.mock('@/lib/llm/runtime-shared', () => ({
  _ulogError: vi.fn(), _ulogWarn: vi.fn(), completionUsageSummary: vi.fn(),
  isRetryableError: vi.fn(() => false), llmLogger: { info: vi.fn(), warn: vi.fn() },
  logLlmRawInput: vi.fn(), logLlmRawOutput: vi.fn(), recordCompletionUsage: vi.fn(),
  recordFailedCompletionUsage: runtime.failures, resolveLlmRuntimeModel: runtime.resolve,
}))
vi.mock('@/lib/llm-observe/internal-stream-context', () => ({ getInternalLLMStreamCallbacks: vi.fn(() => null) }))
import { chatCompletion } from '@/lib/llm/chat-completion'
import { chatCompletionStream } from '@/lib/llm/chat-stream'

describe('no implicit dev text provider bypass', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks() })
  it('still requires a configured model when old dev flags are present', async () => {
    vi.stubEnv('NORI_DEV_TEXT_LLM', 'true')
    await expect(chatCompletion('u1', null, [{ role: 'user', content: 'hello' }]))
      .rejects.toThrow('ANALYSIS_MODEL_NOT_CONFIGURED')
    expect(runtime.resolve).not.toHaveBeenCalled()
  })
  it('applies the same model requirement to streaming requests', async () => {
    vi.stubEnv('NORI_DEV_TEXT_LLM', 'true')
    await expect(chatCompletionStream('u1', null, [{ role: 'user', content: 'hello' }]))
      .rejects.toThrow('ANALYSIS_MODEL_NOT_CONFIGURED')
    expect(runtime.resolve).not.toHaveBeenCalled()
  })
  it('does not fall back to a local provider when configuration resolution fails', async () => {
    vi.stubEnv('NORI_DEV_TEXT_LLM', 'true')
    runtime.resolve.mockRejectedValueOnce(new Error('MODEL_NOT_CONFIGURED'))
    await expect(chatCompletion('u1', 'ghc::unconfigured', [{ role: 'user', content: 'hello' }]))
      .rejects.toThrow('MODEL_NOT_CONFIGURED')
    expect(runtime.resolve).toHaveBeenCalledWith('u1', 'ghc::unconfigured')
  })
})
