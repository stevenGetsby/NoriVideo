import { beforeEach, describe, expect, it, vi } from 'vitest'

const submitTaskMock = vi.hoisted(() => vi.fn())
const prismaMock = vi.hoisted(() => ({
  screenwriterTask: {
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  screenwriterStageState: {
    update: vi.fn(),
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/task/submitter', () => ({ submitTask: submitTaskMock }))

describe('screenwriter task producer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    submitTaskMock.mockResolvedValue({
      success: true,
      async: true,
      taskId: 'worker-task-1',
      status: 'queued',
      deduped: false,
    })
    prismaMock.screenwriterTask.findFirst.mockResolvedValue({
      id: 'sw-task-1',
      userId: 'user-1',
      taskKind: 'script_repaint_2',
    })
  })

  it('submits a text-queue screenwriter mock task with stage payload and records worker task id', async () => {
    const { enqueueScreenwriterMockStage } = await import('@/lib/screenwriter/task-producer')

    const result = await enqueueScreenwriterMockStage({
      userId: 'user-1',
      taskId: 'sw-task-1',
      stage: 'auto_split',
      requestId: 'req-1',
    })

    expect(submitTaskMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      locale: 'zh',
      projectId: 'sw-task-1',
      type: 'screenwriter_mock',
      targetType: 'screenwriter_task',
      targetId: 'sw-task-1',
      requestId: 'req-1',
      payload: expect.objectContaining({
        screenwriterTaskId: 'sw-task-1',
        stage: 'auto_split',
        sleepMs: 10_000,
      }),
    }))
    expect(prismaMock.screenwriterTask.update).toHaveBeenCalledWith({
      where: { id: 'sw-task-1' },
      data: { activeWorkerTaskId: 'worker-task-1' },
    })
    expect(prismaMock.screenwriterStageState.update).toHaveBeenCalledWith({
      where: { screenwriterTaskId_stageKey: { screenwriterTaskId: 'sw-task-1', stageKey: 'auto_split' } },
      data: { workerTaskId: 'worker-task-1', status: 'queued' },
    })
    expect(result.taskId).toBe('worker-task-1')
  })
})
