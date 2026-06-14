import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE } from '@/lib/task/types'

const prismaMock = vi.hoisted(() => ({
  novelPromotionProject: {
    findUnique: vi.fn(),
  },
  workflowStageState: {
    findFirst: vi.fn(),
    upsert: vi.fn(),
  },
}))

const submitTaskMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))

vi.mock('@/lib/task/submitter', () => ({
  submitTask: submitTaskMock,
}))

describe('runStage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.novelPromotionProject.findUnique.mockResolvedValue({ id: 'np-1' })
    prismaMock.workflowStageState.findFirst.mockResolvedValue(null)
    prismaMock.workflowStageState.upsert.mockResolvedValue({})
    submitTaskMock.mockResolvedValue({
      taskId: 'task-1',
      runId: 'run-1',
      deduped: false,
    })
  })

  it('submits config stage as an episode story-to-script task', async () => {
    const { runStage } = await import('@/lib/workflow/run-stage')

    await runStage({
      userId: 'user-1',
      projectId: 'project-1',
      stage: 'config',
      locale: 'zh',
      episodeId: 'episode-1',
      force: true,
    })

    expect(submitTaskMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      projectId: 'project-1',
      episodeId: 'episode-1',
      type: TASK_TYPE.STORY_TO_SCRIPT_RUN,
      targetType: 'NovelPromotionEpisode',
      targetId: 'episode-1',
      payload: expect.objectContaining({
        workflowStage: 'config',
        episodeId: 'episode-1',
      }),
    }))
    expect(prismaMock.workflowStageState.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        userId_projectId_scopeId_stageKey: {
          userId: 'user-1',
          projectId: 'project-1',
          scopeId: 'episode-1',
          stageKey: 'config',
        },
      },
    }))
  })

  it('submits project-level script stage as global asset analysis', async () => {
    const { runStage } = await import('@/lib/workflow/run-stage')

    await runStage({
      userId: 'user-1',
      projectId: 'project-1',
      stage: 'script',
      locale: 'zh',
      force: true,
    })

    expect(submitTaskMock).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1',
      episodeId: null,
      type: TASK_TYPE.ANALYZE_GLOBAL,
      targetType: 'NovelPromotionProject',
      targetId: 'project-1',
      payload: expect.objectContaining({
        workflowStage: 'script',
        episodeId: null,
      }),
    }))
  })

  it('rejects config stage runs without an episode scope', async () => {
    const { runStage } = await import('@/lib/workflow/run-stage')

    await expect(runStage({
      userId: 'user-1',
      projectId: 'project-1',
      stage: 'config',
      locale: 'zh',
      force: true,
    })).rejects.toMatchObject({
      status: 400,
    })

    expect(submitTaskMock).not.toHaveBeenCalled()
    expect(prismaMock.workflowStageState.upsert).not.toHaveBeenCalled()
  })
})
