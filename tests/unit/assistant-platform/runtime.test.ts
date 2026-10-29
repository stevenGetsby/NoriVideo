import { beforeEach, describe, expect, it, vi } from 'vitest'

const getUserModelConfigMock = vi.hoisted(() =>
  vi.fn(async () => ({ analysisModel: null })),
)
const billingMock = vi.hoisted(() => ({
  prepareStreamingTextBilling: vi.fn(),
  rollbackStreamingTextBilling: vi.fn(),
  settleStreamingTextBilling: vi.fn(),
}))
const recordServiceUsageMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/config-service', () => ({
  getUserModelConfig: getUserModelConfigMock,
}))
vi.mock('@/lib/billing/service', () => billingMock)
vi.mock('@/lib/platform-services/usage', () => ({
  recordServiceUsage: recordServiceUsageMock,
}))
vi.mock('@/lib/assistant-platform/registry', () => ({
  getAssistantSkill: vi.fn(),
}))

import { AssistantPlatformError } from '@/lib/assistant-platform'
import { createAssistantChatResponse } from '@/lib/assistant-platform/runtime'

describe('assistant-platform runtime', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('throws invalid request when messages payload is malformed', async () => {
    await expect(createAssistantChatResponse({
      userId: 'user-1',
      assistantId: 'tutorial',
      context: {},
      messages: { invalid: true },
    })).rejects.toMatchObject({
      code: 'ASSISTANT_INVALID_REQUEST',
    } as Partial<AssistantPlatformError>)
  })

  it('throws missing model when analysisModel is not configured', async () => {
    await expect(createAssistantChatResponse({
      userId: 'user-1',
      assistantId: 'tutorial',
      context: {
        providerId: 'openai-compatible:oa-1',
      },
      messages: [{
        id: 'u1',
        role: 'user',
        parts: [{ type: 'text', text: 'hello' }],
      }],
    })).rejects.toMatchObject({
      code: 'ASSISTANT_MODEL_NOT_CONFIGURED',
    } as Partial<AssistantPlatformError>)
  })
})
