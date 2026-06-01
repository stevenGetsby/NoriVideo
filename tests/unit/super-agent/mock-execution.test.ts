import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentExecutionPlan } from '@/lib/super-agent/types'

const prismaMock = {
  novelPromotionProject: {
    findUnique: vi.fn(),
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
}

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))

function createPlan(): AgentExecutionPlan {
  return {
    projectConfig: {
      name: 'mock project',
      videoRatio: '9:16',
      artStyle: 'realistic',
      artStylePrompt: '写实、明亮、产品清晰可见',
    },
    episodeConfig: {
      name: '第1集',
      novelText: '展示智能手表的续航、健康监测和防水能力。',
    },
    selectedSkill: 'product-promo',
    skillDescription: '商品宣传短片',
    executionMode: 'mock',
    creativeParameters: {
      durationSeconds: 24,
      targetAudience: '年轻用户',
      tone: '清晰、有活力',
      sellingPoints: '续航、健康监测、防水',
      callToAction: '立即了解新品',
      narration: 'auto',
      shotCount: 2,
      panelsPerShot: 2,
      mockPrompt: 'Mock prompt for unit test',
    },
    stages: [],
    estimatedDuration: 1,
  }
}

function createPlanWithParameters(
  creativeParameters: Partial<AgentExecutionPlan['creativeParameters']>,
): AgentExecutionPlan {
  const plan = createPlan()
  return {
    ...plan,
    creativeParameters: {
      ...plan.creativeParameters,
      ...creativeParameters,
    },
  }
}

describe('super-agent mock execution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.novelPromotionProject.findUnique.mockResolvedValue({ id: 'novel-project-1' })
    prismaMock.novelPromotionCharacter.create.mockResolvedValue({ id: 'character-1', name: '主角' })
    prismaMock.novelPromotionLocation.create.mockResolvedValue({ id: 'location-1', name: '核心创作场景' })
    prismaMock.novelPromotionClip.create
      .mockResolvedValueOnce({ id: 'clip-1', summary: 'clip 1' })
      .mockResolvedValueOnce({ id: 'clip-2', summary: 'clip 2' })
    prismaMock.novelPromotionClip.findMany.mockResolvedValue([
      {
        id: 'clip-1',
        summary: 'clip 1',
        location: '核心创作场景',
        characters: '主角',
        props: '续航',
        duration: 12,
      },
      {
        id: 'clip-2',
        summary: 'clip 2',
        location: '核心创作场景',
        characters: '主角',
        props: '防水',
        duration: 12,
      },
    ])
    prismaMock.novelPromotionStoryboard.create
      .mockResolvedValueOnce({ id: 'storyboard-1' })
      .mockResolvedValueOnce({ id: 'storyboard-2' })
    prismaMock.novelPromotionPanel.create.mockResolvedValue({})
    prismaMock.novelPromotionVoiceLine.create.mockResolvedValue({})
  })

  it('creates script artifacts from visible creative parameters', async () => {
    const { createMockScriptArtifacts } = await import('@/lib/super-agent/mock-execution')
    const result = await createMockScriptArtifacts({
      projectId: 'project-1',
      episodeId: 'episode-1',
      plan: createPlan(),
    })

    expect(result).toEqual({
      characterCount: 1,
      locationCount: 1,
      clipCount: 2,
      hasScript: true,
    })
    expect(prismaMock.novelPromotionCharacter.create).toHaveBeenCalledTimes(1)
    expect(prismaMock.novelPromotionLocation.create).toHaveBeenCalledTimes(1)
    expect(prismaMock.novelPromotionClip.create).toHaveBeenCalledTimes(2)
  })

  it('creates storyboard panels and voice lines for each mock clip', async () => {
    const { createMockStoryboardArtifacts } = await import('@/lib/super-agent/mock-execution')
    const result = await createMockStoryboardArtifacts({
      episodeId: 'episode-1',
      plan: createPlan(),
    })

    expect(result).toEqual({
      storyboardCount: 2,
      panelCount: 4,
      voiceLineCount: 2,
      hasStoryboard: true,
    })
    expect(prismaMock.novelPromotionStoryboard.create).toHaveBeenCalledTimes(2)
    expect(prismaMock.novelPromotionPanel.create).toHaveBeenCalledTimes(4)
    expect(prismaMock.novelPromotionVoiceLine.create).toHaveBeenCalledTimes(2)
  })

  it('respects narration off by skipping mock voice lines', async () => {
    const { createMockStoryboardArtifacts } = await import('@/lib/super-agent/mock-execution')
    const result = await createMockStoryboardArtifacts({
      episodeId: 'episode-1',
      plan: createPlanWithParameters({ narration: 'off' }),
    })

    expect(result).toMatchObject({
      storyboardCount: 2,
      panelCount: 4,
      voiceLineCount: 0,
      hasStoryboard: true,
    })
    expect(prismaMock.novelPromotionVoiceLine.create).not.toHaveBeenCalled()
  })
})
