import { beforeEach, describe, expect, it, vi } from 'vitest'
import { parseAgentStoryPackageText } from '@/lib/super-agent/agent-story-package'

const callLLMMock = vi.hoisted(() => vi.fn())
const expandMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/super-agent/llm-client', () => ({ llmClient: { callLLM: callLLMMock } }))
vi.mock('@/lib/novel-promotion/ai-story-expand', () => ({ executeAiStoryExpansion: expandMock }))
vi.mock('@/lib/config-service', () => ({
  getUserModelConfig: vi.fn(), buildImageBillingPayload: vi.fn(),
  getProjectModelConfig: vi.fn(), resolveProjectModelCapabilityGenerationOptions: vi.fn(),
}))

describe('SuperAgent immediate planning / background LLM boundary', () => {
  beforeEach(() => vi.clearAllMocks())
  it('returns a deterministic live plan quickly and preserves explicitly supplied creative settings', async () => {
    const { SuperAgentOrchestrator } = await import('@/lib/super-agent/orchestrator')
    const prompt = '制作一个口播视频介绍我们的UGC平台'
    const plan = await new SuperAgentOrchestrator().createExecutionPlan({
      userId: 'u1', locale: 'zh', userInput: prompt, executionMode: 'live',
      parameters: { durationSeconds: 42, shotCount: 4, panelsPerShot: 2, narration: 'on' },
    })
    expect(plan.executionMode).toBe('live')
    expect(plan.selectedSkill).toBe('digital-avatar-ad')
    expect(plan.projectConfig.name).toBe(prompt)
    expect(plan.creativeParameters).toMatchObject({ durationSeconds: 42, shotCount: 4, panelsPerShot: 2, narration: 'on' })
    expect(plan.episodeConfig.novelText).toContain('【NORI_AGENT_STORY_PACKAGE】')
    expect(callLLMMock).not.toHaveBeenCalled()
    expect(expandMock).not.toHaveBeenCalled()
  })
  it('does not wait for or parse a provider response during immediate planning', async () => {
    callLLMMock.mockImplementation(() => new Promise(() => {}))
    const { SuperAgentOrchestrator } = await import('@/lib/super-agent/orchestrator')
    const plan = await new SuperAgentOrchestrator().createExecutionPlan({
      userId: 'u1', locale: 'zh', userInput: '制作一个口播视频介绍我们的UGC平台', executionMode: 'live',
    })
    expect(plan.stages.length).toBeGreaterThan(0)
    expect(plan.selectedSkill).toBe('digital-avatar-ad')
    expect(callLLMMock).not.toHaveBeenCalled()
  })
  it('preserves the original thin story for background expansion without blocking project creation', async () => {
    const prompt = '帮我生成一个可爱的动画短片，小兔子在森林里散步，救起掉进小水坑里的萤火虫。'
    const { SuperAgentOrchestrator } = await import('@/lib/super-agent/orchestrator')
    const plan = await new SuperAgentOrchestrator().createExecutionPlan({
      userId: 'u1', locale: 'zh', userInput: prompt, executionMode: 'live',
    })
    expect(parseAgentStoryPackageText(plan.episodeConfig.novelText)?.expandedStory).toContain('小兔子')
    expect(expandMock).not.toHaveBeenCalled()
    expect(callLLMMock).not.toHaveBeenCalled()
  })
})
