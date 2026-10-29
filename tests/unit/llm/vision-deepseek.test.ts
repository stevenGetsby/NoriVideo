import { beforeEach, describe, expect, it, vi } from 'vitest'

const resolveLlmRuntimeModelMock = vi.hoisted(() => vi.fn(async () => ({
  provider: 'deepseek',
  modelId: 'deepseek-chat',
  modelKey: 'deepseek::deepseek-chat',
  llmProtocol: 'chat-completions' as const,
})))

vi.mock('@/lib/llm-observe/internal-stream-context', () => ({
  getInternalLLMStreamCallbacks: vi.fn(() => null),
}))
vi.mock('@/lib/llm/runtime-shared', () => ({
  _ulogError: vi.fn(),
  resolveLlmRuntimeModel: resolveLlmRuntimeModelMock,
}))

import { chatCompletionWithVisionStream } from '@/lib/llm/vision'

describe('DeepSeek vision limitation', () => {
  beforeEach(() => vi.clearAllMocks())

  it('fails explicitly without reporting completion or success', async () => {
    const callbacks = { onStage: vi.fn(), onComplete: vi.fn(), onError: vi.fn() }
    await expect(chatCompletionWithVisionStream(
      'user-1', 'deepseek::deepseek-chat', 'describe this image', ['https://example.com/image.png'], {}, callbacks,
    )).rejects.toThrow('VISION_NOT_SUPPORTED')
    expect(callbacks.onStage).toHaveBeenCalledTimes(1)
    expect(callbacks.onStage).toHaveBeenCalledWith({ stage: 'submit' })
    expect(callbacks.onComplete).not.toHaveBeenCalled()
    expect(callbacks.onError).toHaveBeenCalledTimes(1)
  })
})
