import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'

const workflowMock = vi.hoisted(() => ({
  completeAutoSplitMockStage: vi.fn(),
  completeFactExtractMockStage: vi.fn(),
  completeTargetSettingsMockStage: vi.fn(),
  completeEpisodeRepaintMockStage: vi.fn(),
}))
const producerMock = vi.hoisted(() => ({
  enqueueScreenwriterMockStage: vi.fn(),
}))
const sharedMock = vi.hoisted(() => ({
  reportTaskProgress: vi.fn(),
}))

vi.mock('@/lib/screenwriter/workflow', () => workflowMock)
vi.mock('@/lib/screenwriter/task-producer', () => producerMock)
vi.mock('@/lib/workers/shared', () => sharedMock)

function buildJob(stage: string, sleepMs = 0) {
  return {
    data: {
      taskId: 'worker-task-1',
      type: TASK_TYPE.SCREENWRITER_MOCK,
      locale: 'zh',
      projectId: 'sw-task-1',
      targetType: 'screenwriter_task',
      targetId: 'sw-task-1',
      userId: 'user-1',
      payload: {
        screenwriterTaskId: 'sw-task-1',
        stage,
        sleepMs,
      },
    } satisfies TaskJobData,
  }
}

describe('screenwriter mock worker handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    workflowMock.completeAutoSplitMockStage.mockResolvedValue({ skipped: false })
    workflowMock.completeFactExtractMockStage.mockResolvedValue({ skipped: false })
    workflowMock.completeTargetSettingsMockStage.mockResolvedValue({ skipped: false })
    workflowMock.completeEpisodeRepaintMockStage.mockResolvedValue({ skipped: false })
    producerMock.enqueueScreenwriterMockStage.mockResolvedValue({ taskId: 'next-worker-task' })
  })

  it('completes auto_split and enqueues fact_extract', async () => {
    const { handleScreenwriterMockTask } = await import('@/lib/workers/handlers/screenwriter-mock')

    const result = await handleScreenwriterMockTask(buildJob('auto_split') as never)

    expect(sharedMock.reportTaskProgress).toHaveBeenCalledWith(expect.anything(), 10, expect.objectContaining({
      stage: 'screenwriter_mock:auto_split',
    }))
    expect(workflowMock.completeAutoSplitMockStage).toHaveBeenCalledWith(expect.objectContaining({
      screenwriterTaskId: 'sw-task-1',
      workerTaskId: 'worker-task-1',
    }))
    expect(producerMock.enqueueScreenwriterMockStage).toHaveBeenCalledWith(expect.objectContaining({
      taskId: 'sw-task-1',
      stage: 'fact_extract',
    }))
    expect(result).toEqual(expect.objectContaining({ stage: 'auto_split', nextStage: 'fact_extract' }))
  })

  it('dispatches checkpoint and repaint stages to workflow helpers', async () => {
    const { handleScreenwriterMockTask } = await import('@/lib/workers/handlers/screenwriter-mock')

    await handleScreenwriterMockTask(buildJob('fact_extract') as never)
    await handleScreenwriterMockTask(buildJob('target_settings') as never)
    await handleScreenwriterMockTask(buildJob('episode_repaint') as never)

    expect(workflowMock.completeFactExtractMockStage).toHaveBeenCalled()
    expect(workflowMock.completeTargetSettingsMockStage).toHaveBeenCalled()
    expect(workflowMock.completeEpisodeRepaintMockStage).toHaveBeenCalled()
  })
})
