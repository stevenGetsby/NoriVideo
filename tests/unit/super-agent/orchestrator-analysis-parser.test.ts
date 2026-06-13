import { beforeEach, describe, expect, it, vi } from 'vitest'

const callLLMMock = vi.hoisted(() => vi.fn())
const executeAiStoryExpansionMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/super-agent/llm-client', () => ({
  llmClient: {
    callLLM: callLLMMock,
  },
}))

vi.mock('@/lib/novel-promotion/ai-story-expand', () => ({
  executeAiStoryExpansion: executeAiStoryExpansionMock,
}))

vi.mock('@/lib/config-service', () => ({
  getUserModelConfig: vi.fn(async () => ({
    analysisModel: 'provider::analysis-model',
    characterModel: 'image::character',
    locationModel: 'image::location',
    storyboardModel: 'image::storyboard',
    editModel: 'image::edit',
    videoModel: 'video::model',
    audioModel: null,
    capabilityDefaults: {},
  })),
  buildImageBillingPayload: vi.fn(),
  getProjectModelConfig: vi.fn(),
  resolveProjectModelCapabilityGenerationOptions: vi.fn(),
}))

describe('SuperAgentOrchestrator LLM analysis parsing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    executeAiStoryExpansionMock.mockResolvedValue({
      expandedText: '扩写后的完整故事内容：主角在清晰场景中遇到问题，做出选择，并用具体动作推动故事进入结尾。',
    })
  })

  it('parses fenced and repairable LLM JSON into a live execution plan', async () => {
    callLLMMock.mockResolvedValue(`
我会按数字人口播来规划。
\`\`\`json
{
  "videoType": "digital-avatar-ad",
  "storyText": "为 UGC 平台制作一支口播视频，突出创作者发布内容、社区互动和平台成长价值。",
  "videoRatio": "9:16",
  "visualStyle": "写实摄影风格，干净背景，数字人口播镜头",
  "projectName": "UGC平台口播介绍",
  "episodeName": "平台介绍",
  "language": "zh",
  "confidence": 0.94,
  "creativeParameters": {
    "durationSeconds": 42,
    "targetAudience": "UGC 创作者和品牌运营",
    "tone": "可信、清晰、有行动引导",
    "sellingPoints": "低门槛发布、社区互动、数据增长",
    "callToAction": "现在加入平台",
    "narration": "on",
    "shotCount": 4,
    "panelsPerShot": 2
  },
}
\`\`\`
`)

    const { SuperAgentOrchestrator } = await import('@/lib/super-agent/orchestrator')
    const orchestrator = new SuperAgentOrchestrator()
    const plan = await orchestrator.createExecutionPlan({
      userId: 'user-1',
      locale: 'zh',
      userInput: '制作一个口播视频介绍我们的UGC平台',
      executionMode: 'live',
    })

    expect(plan.executionMode).toBe('live')
    expect(plan.selectedSkill).toBe('digital-avatar-ad')
    expect(plan.projectConfig).toMatchObject({
      name: 'UGC平台口播介绍',
      videoRatio: '9:16',
      artStylePrompt: '写实摄影风格，干净背景，数字人口播镜头',
    })
    expect(plan.episodeConfig).toMatchObject({
      name: '平台介绍',
      novelText: expect.stringContaining('【NORI_AGENT_STORY_PACKAGE】'),
    })
    expect(plan.episodeConfig.novelText).toContain('UGC 平台')
    expect(plan.creativeParameters).toMatchObject({
      durationSeconds: 42,
      targetAudience: 'UGC 创作者和品牌运营',
      tone: '可信、清晰、有行动引导',
      sellingPoints: '低门槛发布、社区互动、数据增长',
      callToAction: '现在加入平台',
      narration: 'on',
      shotCount: 4,
      panelsPerShot: 2,
    })
    expect(callLLMMock).toHaveBeenCalledWith(
      'user-1',
      expect.stringContaining('ugc-platform-promo'),
      '制作一个口播视频介绍我们的UGC平台',
    )
  })

  it('falls back to deterministic analysis when the model returns plain text', async () => {
    callLLMMock.mockResolvedValue('可以，我会制作一支介绍 UGC 平台的口播视频。')

    const { SuperAgentOrchestrator } = await import('@/lib/super-agent/orchestrator')
    const orchestrator = new SuperAgentOrchestrator()
    const plan = await orchestrator.createExecutionPlan({
      userId: 'user-1',
      locale: 'zh',
      userInput: '制作一个口播视频介绍我们的UGC平台',
      executionMode: 'live',
    })

    expect(plan.executionMode).toBe('live')
    expect(plan.selectedSkill).toBe('ugc-platform-promo')
    expect(plan.projectConfig.name).toBe('制作一个口播视频介绍我们的UGC平台')
    expect(plan.episodeConfig.novelText).toContain('【NORI_AGENT_STORY_PACKAGE】')
    expect(plan.episodeConfig.novelText).toContain('制作一个口播视频介绍我们的UGC平台')
    expect(executeAiStoryExpansionMock).not.toHaveBeenCalled()
  })

  it('expands thin generic storyText with manual smart-creation structure', async () => {
    executeAiStoryExpansionMock.mockResolvedValueOnce({
      expandedText: [
        '故事从这个设定展开：一天晚上，小兔子在森林小路上散步，月光照在湿润的草叶上。',
        '它发现萤火虫掉进小水坑后立刻停下脚步，压低身体观察水面，伸出树叶帮助对方脱困。',
        '每一个动作都要能拆成分镜：发现、靠近、救援、感谢、收到月亮灯、照亮回家的路。',
      ].join('\n\n'),
    })
    callLLMMock.mockResolvedValue(JSON.stringify({
      videoType: 'generic',
      storyText: '小兔子在森林里散步，救了萤火虫。',
      videoRatio: '9:16',
      visualStyle: '可爱童话动画风',
      projectName: '月亮灯',
      episodeName: '第1集',
      language: 'zh',
      confidence: 0.92,
      creativeParameters: {
        durationSeconds: 45,
        tone: '温暖治愈',
        narration: 'auto',
        shotCount: 6,
        panelsPerShot: 3,
      },
    }))

    const { SuperAgentOrchestrator } = await import('@/lib/super-agent/orchestrator')
    const { parseAgentStoryPackageText } = await import('@/lib/super-agent/agent-story-package')
    const orchestrator = new SuperAgentOrchestrator()
    const userInput = '帮我生成一个可爱的动画短片，故事是一天晚上，小兔子在森林里散步，救起掉进小水坑里的萤火虫。'
    const plan = await orchestrator.createExecutionPlan({
      userId: 'user-1',
      locale: 'zh',
      userInput,
      executionMode: 'live',
    })

    const storyPackage = parseAgentStoryPackageText(plan.episodeConfig.novelText)
    expect(storyPackage?.expandedStory).toContain('故事从这个设定展开')
    expect(storyPackage?.expandedStory).toContain('每一个动作都要能拆成分镜')
    expect(storyPackage?.expandedStory.length || 0).toBeGreaterThan(userInput.length * 2)
    expect(executeAiStoryExpansionMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      prompt: userInput,
      locale: 'zh',
      projectId: 'super-agent-story-expand',
      action: 'super-agent.story-expand',
      stepId: 'agent_story_expand',
    }))
    expect(callLLMMock).toHaveBeenCalledWith(
      'user-1',
      expect.stringContaining('普通故事/童话/剧情短片必须生成 300-800 字故事正文'),
      userInput,
    )
  })

  it('keeps the original role-asset prompt inside the Agent story package', async () => {
    callLLMMock.mockResolvedValue(JSON.stringify({
      videoType: 'generic',
      storyText: 'Ava 在现代美国医院走廊请求 Dr. Grayson 帮外婆安排手术，Nurse Sarah 质疑她，Dr. Grayson 维护她并留下暧昧悬念。',
      videoRatio: '9:16',
      visualStyle: '欧美医疗短剧，真实真人质感，英文口型',
      projectName: '医院走廊的秘密',
      episodeName: '第1集',
      language: 'zh',
      confidence: 0.95,
      creativeParameters: {
        durationSeconds: 60,
        tone: '紧张、暧昧',
        narration: 'off',
        shotCount: 6,
        panelsPerShot: 2,
      },
    }))

    const input = [
      '请用 Agent 自动创作模式生成一支 9:16 欧美医疗短剧转绘视频，真实真人短剧质感，英文口型，不要中文字幕，不要背景音乐。',
      '角色资产：',
      'Ava：年轻美国女性，24-27 岁，黑框眼镜，奶白色针织开衫。',
      'Dr. Grayson：美国男外科医生，白大褂，冷静克制。',
      '剧情：Ava 在医院走廊请求 Dr. Grayson 帮外婆安排手术，却被 Nurse Sarah 质疑钱的来源。',
    ].join('\n')

    const { SuperAgentOrchestrator } = await import('@/lib/super-agent/orchestrator')
    const { parseAgentStoryPackageText } = await import('@/lib/super-agent/agent-story-package')
    const orchestrator = new SuperAgentOrchestrator()
    const plan = await orchestrator.createExecutionPlan({
      userId: 'user-1',
      locale: 'zh',
      userInput: input,
      executionMode: 'live',
    })

    const storyPackage = parseAgentStoryPackageText(plan.episodeConfig.novelText)
    expect(storyPackage?.originalPrompt).toContain('角色资产')
    expect(storyPackage?.roleAssets.map((role) => role.name)).toEqual(['Ava', 'Dr. Grayson'])
    expect(storyPackage?.dialogueLanguage).toBe('en')
    expect(storyPackage?.settingRegion).toBe('western')
    expect(storyPackage?.noSubtitles).toBe(true)
    expect(storyPackage?.noMusic).toBe(true)
    expect(executeAiStoryExpansionMock).not.toHaveBeenCalled()
  })
})
