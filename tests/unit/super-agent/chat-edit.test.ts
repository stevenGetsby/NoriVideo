import { beforeEach, describe, expect, it, vi } from 'vitest'

const recordAgentChatEditWorkflowMock = vi.hoisted(() => vi.fn())
const episodeUpdateMock = vi.hoisted(() => vi.fn())
const panelUpdateMock = vi.hoisted(() => vi.fn())
const prismaMock = vi.hoisted(() => ({
  novelPromotionEpisode: {
    findUnique: vi.fn(),
    update: episodeUpdateMock,
  },
  novelPromotionPanel: {
    findUnique: vi.fn(async () => ({
      id: 'panel-1', storyboardId: 'storyboard-1', panelIndex: 0, videoPrompt: null,
      characters: '[]', props: '[]', location: null, actingNotes: null,
      storyboard: { episode: { novelPromotionProject: { characters: [], locations: [] } } },
    })),
    update: panelUpdateMock,
  },
  $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => {
    return await callback({
      novelPromotionEpisode: { update: episodeUpdateMock },
      novelPromotionPanel: { update: panelUpdateMock },
    })
  }),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))
vi.mock('@/lib/config-service', () => ({
  getProjectModelConfig: vi.fn(async () => ({ analysisModel: null, characterModel: null, locationModel: null, editModel: null })),
}))

vi.mock('@/lib/super-agent/workflow-store', () => ({
  recordAgentChatEditWorkflow: recordAgentChatEditWorkflowMock,
}))

describe('applyAgentChatEdit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.novelPromotionEpisode.findUnique.mockResolvedValue({
      id: 'episode-1',
      name: '第1集',
      novelText: '旧文本',
      novelPromotionProject: {
        projectId: 'project-1',
        workflowMode: 'agent',
        characters: [],
        locations: [],
      },
      storyboards: [{
        panels: [{
          id: 'panel-1',
          panelIndex: 0,
          description: '旧分镜',
          imagePrompt: '旧图片提示词',
          videoPrompt: null,
          srtSegment: null,
        }],
      }],
    })
    episodeUpdateMock.mockResolvedValue({})
    panelUpdateMock.mockResolvedValue({})
    recordAgentChatEditWorkflowMock.mockResolvedValue({ id: 'chat-edit-run-1' })
  })

  it('updates the requested video prompt without rewriting the locked source script', async () => {
    const { applyAgentChatEdit } = await import('@/lib/super-agent/chat-edit')

    const result = await applyAgentChatEdit({
      userId: 'user-1',
      projectId: 'project-1',
      episodeId: 'episode-1',
      instruction: '语气更年轻，突出环保卖点',
      mode: 'mock',
      selectedSkill: 'product-promo',
    })

    expect(episodeUpdateMock).not.toHaveBeenCalled()
    expect(panelUpdateMock).toHaveBeenCalledWith({
      where: { id: 'panel-1' },
      data: expect.objectContaining({
        videoPrompt: expect.stringContaining('语气更年轻，突出环保卖点'),
      }),
    })
    expect(recordAgentChatEditWorkflowMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      projectId: 'project-1',
      episodeId: 'episode-1',
      selectedSkill: 'product-promo',
      instruction: '语气更年轻，突出环保卖点',
      appliedChanges: expect.objectContaining({
        episodeUpdated: false,
      }),
    }))
    expect(result).toMatchObject({
      summary: '已记录修改要求，并更新首个分镜视频提示词。',
      episodeUpdated: false,
      panelChanges: [{
        id: 'panel-1',
        changedFields: ['videoPrompt'],
      }],
      workflowRunId: 'chat-edit-run-1',
    })
  })
})
