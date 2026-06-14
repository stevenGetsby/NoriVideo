import { beforeEach, describe, expect, it, vi } from 'vitest'

const getUserModelConfigMock = vi.hoisted(() => vi.fn())
const getProjectModelConfigMock = vi.hoisted(() => vi.fn())
const runModelGatewayTextCompletionMock = vi.hoisted(() => vi.fn())
const getCompletionContentMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/config-service', () => ({
  getProjectModelConfig: getProjectModelConfigMock,
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
    getProjectModelConfigMock.mockResolvedValue({ analysisModel: 'openai-compatible::project-gpt' })
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
        reasoning: true,
        reasoningEffort: 'medium',
        maxRetries: 0,
        projectId: undefined,
        action: 'super-agent.llm',
      },
    })
    expect(getCompletionContentMock).toHaveBeenCalledWith({ id: 'completion-1' })
  })

  it('falls back to Lumina GPT-5.5 when analysis model is not configured', async () => {
    getProjectModelConfigMock.mockResolvedValue({ analysisModel: null })
    getUserModelConfigMock.mockResolvedValue({ analysisModel: null })
    const client = new SuperAgentLLMClient()

    await expect(client.callLLM('user-1', 'system', 'user')).resolves.toBe('{"ok":true}')
    expect(runModelGatewayTextCompletionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'lumina::gpt-5.5',
      }),
    )
  })

  it('uses project analysis model when projectId is provided', async () => {
    const client = new SuperAgentLLMClient()

    await expect(client.callLLM('user-1', 'system', 'user', { projectId: 'project-1' })).resolves.toBe('{"ok":true}')
    expect(getProjectModelConfigMock).toHaveBeenCalledWith('project-1', 'user-1')
    expect(getUserModelConfigMock).not.toHaveBeenCalled()
    expect(runModelGatewayTextCompletionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'openai-compatible::project-gpt',
      }),
    )
  })
})
