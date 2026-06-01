import { beforeEach, describe, expect, it, vi } from 'vitest'

const getUserModelConfigMock = vi.hoisted(() => vi.fn())
const runModelGatewayTextCompletionMock = vi.hoisted(() => vi.fn())
const getCompletionContentMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/config-service', () => ({
  getUserModelConfig: getUserModelConfigMock,
}))

vi.mock('@/lib/model-gateway/llm', () => ({
  runModelGatewayTextCompletion: runModelGatewayTextCompletionMock,
}))

vi.mock('@/lib/llm-client', () => ({
  getCompletionContent: getCompletionContentMock,
}))

import { SuperAgentLLMClient } from '@/lib/super-agent/llm-client'

describe('SuperAgentLLMClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getUserModelConfigMock.mockResolvedValue({ analysisModel: 'openai-compatible::gpt-4.1-mini' })
    runModelGatewayTextCompletionMock.mockResolvedValue({ id: 'completion-1' })
    getCompletionContentMock.mockReturnValue('{"ok":true}')
  })

  it('uses the unified model gateway for live planning calls', async () => {
    const client = new SuperAgentLLMClient()
    const result = await client.callLLM('user-1', 'system prompt', 'user prompt')

    expect(result).toBe('{"ok":true}')
    expect(runModelGatewayTextCompletionMock).toHaveBeenCalledWith({
      userId: 'user-1',
      model: 'openai-compatible::gpt-4.1-mini',
      messages: [
        { role: 'system', content: 'system prompt' },
        { role: 'user', content: 'user prompt' },
      ],
      options: {
        temperature: 0.2,
        action: 'super-agent.plan',
      },
    })
    expect(getCompletionContentMock).toHaveBeenCalledWith({ id: 'completion-1' })
  })

  it('fails clearly when analysis model is not configured', async () => {
    getUserModelConfigMock.mockResolvedValue({ analysisModel: null })
    const client = new SuperAgentLLMClient()

    await expect(client.callLLM('user-1', 'system', 'user')).rejects.toThrow(
      'analysisModel is required',
    )
    expect(runModelGatewayTextCompletionMock).not.toHaveBeenCalled()
  })
})
