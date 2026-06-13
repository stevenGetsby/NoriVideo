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

  it('applies deterministic mock edits to editable episode and panel artifacts', async () => {
    const { applyAgentChatEdit } = await import('@/lib/super-agent/chat-edit')

    const result = await applyAgentChatEdit({
      userId: 'user-1',
      projectId: 'project-1',
      episodeId: 'episode-1',
      instruction: '语气更年轻，突出环保卖点',
      mode: 'mock',
      selectedSkill: 'product-promo',
    })

    expect(episodeUpdateMock).toHaveBeenCalledWith({
      where: { id: 'episode-1' },
      data: {
        novelText: expect.stringContaining('语气更年轻，突出环保卖点'),
      },
    })
    expect(panelUpdateMock).toHaveBeenCalledWith({
      where: { id: 'panel-1' },
      data: expect.objectContaining({
        description: expect.stringContaining('语气更年轻，突出环保卖点'),
        imagePrompt: expect.stringContaining('语气更年轻，突出环保卖点'),
      }),
    })
    expect(recordAgentChatEditWorkflowMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      projectId: 'project-1',
      episodeId: 'episode-1',
      selectedSkill: 'product-promo',
      instruction: '语气更年轻，突出环保卖点',
      appliedChanges: expect.objectContaining({
        episodeUpdated: true,
      }),
    }))
    expect(result).toEqual({
      summary: '已记录修改要求，并更新第一集文本与首个分镜说明。',
      episodeUpdated: true,
      panelChanges: [{
        id: 'panel-1',
        changedFields: ['description', 'imagePrompt'],
      }],
      workflowRunId: 'chat-edit-run-1',
    })
  })
})
