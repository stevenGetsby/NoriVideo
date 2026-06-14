import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  workflowStageState: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
    upsert: vi.fn(),
  },
  novelPromotionProject: {
    findUnique: vi.fn(),
  },
}))

const submitTaskMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))

vi.mock('@/lib/task/submitter', () => ({
  submitTask: submitTaskMock,
}))

describe('retryStage', () => {
  beforeEach(() => {
    prismaMock.workflowStageState.findUnique.mockReset()
    prismaMock.workflowStageState.findMany.mockReset()
    prismaMock.workflowStageState.findFirst.mockReset()
    prismaMock.workflowStageState.upsert.mockReset()
    prismaMock.novelPromotionProject.findUnique.mockReset()
    submitTaskMock.mockReset()
    prismaMock.workflowStageState.findUnique.mockResolvedValue(null)
    prismaMock.workflowStageState.findMany.mockResolvedValue([])
    prismaMock.workflowStageState.findFirst.mockResolvedValue(null)
    prismaMock.novelPromotionProject.findUnique.mockResolvedValue({ id: 'np-project-1' })
    prismaMock.workflowStageState.upsert.mockResolvedValue({})
    submitTaskMock.mockResolvedValue({
      taskId: 'task-new',
      runId: 'run-new',
      deduped: false,
    })
  })

  it('resubmits retryable failed stages through submitTask and records retry metadata', async () => {
    prismaMock.workflowStageState.findUnique
      .mockResolvedValueOnce({
        status: 'failed',
        lastTaskId: 'task-old',
        lastRunId: 'run-old',
        errorCode: 'PROVIDER_FAILED',
        errorMessage: 'provider failed',
      })
      .mockResolvedValueOnce({
        status: 'failed',
        reviewState: 'review',
      })
    prismaMock.workflowStageState.findMany.mockResolvedValue([
      {
        stageKey: 'config',
        status: 'approved',
        reviewState: 'confirmed',
      },
      {
        stageKey: 'script',
        status: 'approved',
        reviewState: 'confirmed',
      },
      {
        stageKey: 'storyboard',
        status: 'failed',
        reviewState: 'review',
      },
    ])
    const { retryStage } = await import('@/lib/workflow/run-stage')

    const result = await retryStage({
      userId: 'user-1',
      projectId: 'project-1',
      stage: 'storyboard',
      locale: 'zh',
      episodeId: 'episode-1',
      input: { reason: 'manual retry' },
      requestId: 'req-1',
    })

    expect(result).toMatchObject({
      stage: 'storyboard',
      status: 'queued',
      taskId: 'task-new',
      runId: 'run-new',
      retried: true,
      previousStatus: 'failed',
      previousTaskId: 'task-old',
      previousRunId: 'run-old',
    })
    expect(submitTaskMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      projectId: 'project-1',
      episodeId: 'episode-1',
      type: 'script_to_storyboard_run',
      requestId: 'req-1',
      payload: expect.objectContaining({
        reason: 'manual retry',
        retryOfTaskId: 'task-old',
        retryOfRunId: 'run-old',
        retryErrorCode: 'PROVIDER_FAILED',
        retryErrorMessage: 'provider failed',
      }),
    }))
    expect(prismaMock.workflowStageState.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        userId_projectId_scopeId_stageKey: {
          userId: 'user-1',
          projectId: 'project-1',
          scopeId: 'episode-1',
          stageKey: 'storyboard',
        },
      },
      update: expect.objectContaining({
        status: 'queued',
        lastTaskId: 'task-new',
        lastRunId: 'run-new',
        errorCode: null,
        errorMessage: null,
      }),
    }))
  })

  it('rejects non-retryable idle stages without submitting a task', async () => {
    prismaMock.workflowStageState.findUnique.mockResolvedValueOnce(null)
    const { retryStage } = await import('@/lib/workflow/run-stage')

    await expect(retryStage({
      userId: 'user-1',
      projectId: 'project-1',
      stage: 'storyboard',
      locale: 'zh',
    })).rejects.toMatchObject({
      code: 'INVALID_PARAMS',
      details: expect.objectContaining({
        currentStatus: 'idle',
      }),
    })
    expect(submitTaskMock).not.toHaveBeenCalled()
  })
})
