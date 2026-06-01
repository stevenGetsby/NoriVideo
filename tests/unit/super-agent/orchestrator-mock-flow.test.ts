import { beforeEach, describe, expect, it, vi } from 'vitest'

const getUserModelConfigMock = vi.hoisted(() => vi.fn())
const prismaMock = vi.hoisted(() => ({
  project: {
    create: vi.fn(),
  },
  novelPromotionProject: {
    create: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  novelPromotionEpisode: {
    create: vi.fn(),
  },
  novelPromotionCharacter: {
    create: vi.fn(),
  },
  novelPromotionLocation: {
    create: vi.fn(),
  },
  novelPromotionClip: {
    create: vi.fn(),
    findMany: vi.fn(),
  },
  novelPromotionStoryboard: {
    create: vi.fn(),
  },
  novelPromotionPanel: {
    create: vi.fn(),
  },
  novelPromotionVoiceLine: {
    create: vi.fn(),
  },
}))

vi.mock('@/lib/config-service', () => ({
  getUserModelConfig: getUserModelConfigMock,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))

describe('SuperAgentOrchestrator mock flow', () => {
  let createdClips: Array<Record<string, unknown>>
  let createdStoryboards: Array<Record<string, unknown> & { panels: Array<Record<string, unknown>> }>
  let createdVoiceLines: Array<Record<string, unknown>>

  beforeEach(() => {
    vi.clearAllMocks()

    createdClips = []
    createdStoryboards = []
    createdVoiceLines = []

    getUserModelConfigMock.mockResolvedValue({
      analysisModel: 'openai-compatible::analysis',
      characterModel: 'image::character',
      locationModel: 'image::location',
      storyboardModel: 'image::storyboard',
      editModel: 'image::edit',
      videoModel: 'video::model',
      audioModel: 'audio::model',
    })

    prismaMock.project.create.mockResolvedValue({ id: 'project-1' })
    prismaMock.novelPromotionProject.create.mockResolvedValue({ id: 'novel-project-1' })
    prismaMock.novelPromotionProject.findUnique.mockResolvedValue({ id: 'novel-project-1' })
    prismaMock.novelPromotionProject.update.mockResolvedValue({})
    prismaMock.novelPromotionEpisode.create.mockResolvedValue({ id: 'episode-1' })
    prismaMock.novelPromotionCharacter.create.mockResolvedValue({ id: 'character-1', name: '目标用户代表' })
    prismaMock.novelPromotionLocation.create.mockResolvedValue({ id: 'location-1', name: '核心创作场景' })
    prismaMock.novelPromotionClip.create.mockImplementation(async ({ data }) => {
      const clip = { id: `clip-${createdClips.length + 1}`, ...data }
      createdClips.push(clip)
      return clip
    })
    prismaMock.novelPromotionClip.findMany.mockImplementation(async () => createdClips)
    prismaMock.novelPromotionStoryboard.create.mockImplementation(async ({ data }) => {
      const storyboard = { id: `storyboard-${createdStoryboards.length + 1}`, panels: [], ...data }
      createdStoryboards.push(storyboard)
      return storyboard
    })
    prismaMock.novelPromotionPanel.create.mockImplementation(async ({ data }) => {
      const panel = { id: `panel-${createdStoryboards.reduce((sum, storyboard) => sum + storyboard.panels.length, 0) + 1}`, ...data }
      const storyboard = createdStoryboards.find((item) => item.id === data.storyboardId)
      storyboard?.panels.push(panel)
      return panel
    })
    prismaMock.novelPromotionVoiceLine.create.mockImplementation(async ({ data }) => {
      const voiceLine = { id: `voice-line-${createdVoiceLines.length + 1}`, ...data }
      createdVoiceLines.push(voiceLine)
      return voiceLine
    })
  })

  it('creates a complete editable mock project from prompt to workspace url', async () => {
    const { SuperAgentOrchestrator } = await import('@/lib/super-agent/orchestrator')
    const orchestrator = new SuperAgentOrchestrator()
    const context = {
      userId: 'user-1',
      locale: 'zh',
      userInput: '制作一个16:9智能手表商品宣传短片，面向年轻用户，强调续航和防水。',
      executionMode: 'mock' as const,
      parameters: {
        durationSeconds: 24,
        targetAudience: '年轻用户',
        tone: '清晰、有活力',
        sellingPoints: '长续航、防水',
        callToAction: '立即了解新品',
        narration: 'off' as const,
        shotCount: 2,
        panelsPerShot: 2,
        mockPrompt: 'Mock prompt: 生成可编辑的智能手表广告项目。',
      },
    }

    const plan = await orchestrator.createExecutionPlan(context)
    expect(plan.executionMode).toBe('mock')
    expect(plan.selectedSkill).toBe('product-promo')
    expect(plan.projectConfig.videoRatio).toBe('16:9')
    expect(plan.creativeParameters).toMatchObject({
      durationSeconds: 24,
      shotCount: 2,
      panelsPerShot: 2,
      narration: 'off',
      mockPrompt: 'Mock prompt: 生成可编辑的智能手表广告项目。',
    })

    const onProgress = vi.fn()
    const result = await orchestrator.executePlan(plan, context, onProgress)
    const { resolveEpisodeStageArtifacts } = await import('@/lib/novel-promotion/stage-readiness')

    expect(result).toMatchObject({
      projectId: 'project-1',
      episodeId: 'episode-1',
      status: 'completed',
      workspaceUrl: '/zh/workspace/project-1?episode=episode-1',
      stageResults: {
        stage1: { projectId: 'project-1', episodeId: 'episode-1', hasStory: true },
        stage2: { characterCount: 1, locationCount: 1, clipCount: 2, hasScript: true },
        stage3: { storyboardCount: 2, panelCount: 4, voiceLineCount: 0, hasStoryboard: true },
      },
    })
    expect(prismaMock.project.create).toHaveBeenCalledWith({
      data: {
        name: expect.stringContaining('智能手表'),
        description: 'Created by Super Agent (mock)',
        userId: 'user-1',
      },
    })
    expect(prismaMock.novelPromotionPanel.create).toHaveBeenCalledTimes(4)
    expect(prismaMock.novelPromotionVoiceLine.create).not.toHaveBeenCalled()
    expect(resolveEpisodeStageArtifacts({
      novelText: plan.episodeConfig.novelText,
      clips: createdClips,
      storyboards: createdStoryboards,
      voiceLines: createdVoiceLines,
    })).toMatchObject({
      hasStory: true,
      hasScript: true,
      hasStoryboard: true,
      hasVoice: false,
    })
    expect(onProgress).toHaveBeenLastCalledWith('完成', 100)
  })
})
