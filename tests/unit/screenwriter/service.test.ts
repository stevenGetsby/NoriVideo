import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  screenwriterTask: {
    create: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
  },
  screenwriterStageState: {
    update: vi.fn(),
  },
  screenwriterSettingsReview: {
    update: vi.fn(),
  },
  screenwriterReviewFeedback: {
    create: vi.fn(),
  },
  $transaction: vi.fn(),
}))
const producerMock = vi.hoisted(() => ({
  enqueueScreenwriterMockStage: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/screenwriter/task-producer', () => producerMock)

describe('screenwriter service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    producerMock.enqueueScreenwriterMockStage.mockResolvedValue({
      success: true,
      async: true,
      taskId: 'worker-task-1',
      status: 'queued',
      deduped: false,
    })
    prismaMock.$transaction.mockImplementation(async (callback: (tx: typeof prismaMock) => Promise<unknown>) => {
      return await callback(prismaMock)
    })
  })

  it('creates a persisted video repaint task with source video and six stages', async () => {
    const { createVideoRepaintTask } = await import('@/lib/screenwriter/service')
    prismaMock.screenwriterTask.create.mockResolvedValue({
      id: 'sw-task-1',
      title: 'Demo Task',
      taskKind: 'video_repaint_2',
      status: 'draft',
      activeTaskLabel: '进行中',
      currentStage: 'auto_split',
      currentStageStatus: 'running',
      episodeCount: 1,
      requirement: 'make it modern',
      transferForm: 'script',
      uploadMode: 'file',
      updatedAt: new Date('2026-07-02T00:00:00.000Z'),
      stageStates: [
        { stageKey: 'auto_split', title: '自动拆集', subtitle: '', status: 'running', checkpoint: null },
        { stageKey: 'fact_extract', title: '事实卡提取', subtitle: '', status: 'not_started', checkpoint: null },
        { stageKey: 'source_settings', title: '源设定', subtitle: '', status: 'not_started', checkpoint: 'A' },
        { stageKey: 'episode_alignment', title: '逐集对齐', subtitle: '', status: 'not_started', checkpoint: null },
        { stageKey: 'target_settings', title: '目标设定', subtitle: '', status: 'not_started', checkpoint: 'B' },
        { stageKey: 'episode_repaint', title: '逐集转绘', subtitle: '', status: 'not_started', checkpoint: null },
      ],
      sourceVideos: [],
      settingsReviews: [],
      episodeProcesses: [],
      scriptEpisodes: [],
    })

    const result = await createVideoRepaintTask({
      userId: 'user-1',
      title: 'Demo Task',
      transferForm: 'script',
      uploadMode: 'file',
      sourceAssetName: 'source.mp4',
      requirement: 'make it modern',
      checkpoints: { A: true, B: true },
    })

    expect(prismaMock.screenwriterTask.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        userId: 'user-1',
        title: 'Demo Task',
        taskKind: 'video_repaint_2',
        currentStage: 'auto_split',
        currentStageStatus: 'running',
        sourceVideos: {
          create: [expect.objectContaining({ fileName: 'source.mp4', episodeNumber: 1 })],
        },
        stageStates: {
          create: expect.arrayContaining([
            expect.objectContaining({ stageKey: 'auto_split', status: 'running' }),
            expect.objectContaining({ stageKey: 'source_settings', checkpoint: 'A' }),
            expect.objectContaining({ stageKey: 'target_settings', checkpoint: 'B' }),
          ]),
        },
      }),
      include: expect.any(Object),
    }))
    expect(result).toEqual({
      id: 'sw-task-1',
      title: 'Demo Task',
      nextRoute: '/screenwriter/video-repaint/sw-task-1',
    })
  })

  it('creates a persisted script repaint task with source script artifact and five stages', async () => {
    const { createScriptRepaintTask } = await import('@/lib/screenwriter/service')
    prismaMock.screenwriterTask.create.mockResolvedValue({
      id: 'sw-script-1',
      title: 'Script Demo',
      taskKind: 'script_repaint_2',
      status: 'draft',
      activeTaskLabel: '进行中',
      currentStage: 'auto_split',
      currentStageStatus: 'running',
      episodeCount: 1,
      requirement: 'make it modern',
      transferForm: 'script',
      uploadMode: 'paste',
      updatedAt: new Date('2026-07-02T00:00:00.000Z'),
      stageStates: [
        { stageKey: 'auto_split', title: '自动拆集', subtitle: '', status: 'running', checkpoint: null },
        { stageKey: 'fact_extract', title: '事实卡提取', subtitle: '', status: 'not_started', checkpoint: null },
        { stageKey: 'source_settings', title: '源设定', subtitle: '', status: 'not_started', checkpoint: 'A' },
        { stageKey: 'target_settings', title: '目标设定', subtitle: '', status: 'not_started', checkpoint: 'B' },
        { stageKey: 'episode_repaint', title: '逐集转绘', subtitle: '', status: 'not_started', checkpoint: null },
      ],
      sourceVideos: [],
      settingsReviews: [],
      episodeProcesses: [],
      scriptEpisodes: [],
    })

    const result = await createScriptRepaintTask({
      userId: 'user-1',
      title: 'Script Demo',
      sourceInputMode: 'paste',
      sourceScriptText: '第一集\n女主进入公司。',
      requirement: 'make it modern',
      checkpoints: { A: true, B: true },
    })

    expect(prismaMock.screenwriterTask.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        userId: 'user-1',
        title: 'Script Demo',
        taskKind: 'script_repaint_2',
        currentStage: 'auto_split',
        currentStageStatus: 'running',
        transferForm: 'script',
        uploadMode: 'paste',
        artifacts: {
          create: [expect.objectContaining({
            stageKey: 'auto_split',
            artifactType: 'source_script_raw',
            refId: 'source-script',
            payload: expect.objectContaining({
              sourceInputMode: 'paste',
              sourceScriptText: '第一集\n女主进入公司。',
            }),
          })],
        },
        stageStates: {
          create: [
            expect.objectContaining({ stageKey: 'auto_split', status: 'running' }),
            expect.objectContaining({ stageKey: 'fact_extract', status: 'not_started' }),
            expect.objectContaining({ stageKey: 'source_settings', checkpoint: 'A' }),
            expect.objectContaining({ stageKey: 'target_settings', checkpoint: 'B' }),
            expect.objectContaining({ stageKey: 'episode_repaint', status: 'not_started' }),
          ],
        },
      }),
      include: expect.any(Object),
    }))
    const createArgs = prismaMock.screenwriterTask.create.mock.calls.at(-1)?.[0] as {
      data?: { sourceVideos?: unknown; stageStates?: { create?: Array<{ stageKey: string }> } }
    }
    expect(createArgs.data?.sourceVideos).toBeUndefined()
    expect(createArgs.data?.stageStates?.create?.map((stage) => stage.stageKey)).not.toContain('episode_alignment')
    expect(result).toEqual({
      id: 'sw-script-1',
      title: 'Script Demo',
      nextRoute: '/screenwriter/script-repaint/sw-script-1',
    })
    expect(producerMock.enqueueScreenwriterMockStage).toHaveBeenCalledWith({
      userId: 'user-1',
      taskId: 'sw-script-1',
      stage: 'auto_split',
    })
  })

  it('lists task summaries with search, status, kind and pagination', async () => {
    const { listScreenwriterTasks } = await import('@/lib/screenwriter/service')
    prismaMock.screenwriterTask.count.mockResolvedValue(1)
    prismaMock.screenwriterTask.findMany.mockResolvedValue([
      {
        id: 'sw-task-1',
        title: 'Demo Task',
        taskKind: 'video_repaint_2',
        status: 'draft',
        activeTaskLabel: '进行中',
        currentStage: 'source_settings',
        currentStageStatus: 'waiting_check',
        episodeCount: 2,
        updatedAt: new Date('2026-07-02T00:00:00.000Z'),
      },
    ])

    const result = await listScreenwriterTasks({
      userId: 'user-1',
      status: 'draft',
      taskKind: 'video_repaint_2',
      search: 'Demo',
      page: 2,
      pageSize: 10,
    })

    expect(prismaMock.screenwriterTask.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        userId: 'user-1',
        status: 'draft',
        taskKind: 'video_repaint_2',
        OR: [{ title: { contains: 'Demo' } }, { requirement: { contains: 'Demo' } }],
      },
      skip: 10,
      take: 10,
    }))
    expect(result).toMatchObject({
      total: 1,
      page: 2,
      pageSize: 10,
      tasks: [{
        id: 'sw-task-1',
        activeTaskId: 'sw-task-1',
        nextRoute: '/screenwriter/video-repaint/sw-task-1/source-settings',
      }],
    })
  })

  it('routes script repaint task summaries to script repaint pages', async () => {
    const { listScreenwriterTasks } = await import('@/lib/screenwriter/service')
    prismaMock.screenwriterTask.count.mockResolvedValue(1)
    prismaMock.screenwriterTask.findMany.mockResolvedValue([
      {
        id: 'sw-script-1',
        title: 'Script Task',
        taskKind: 'script_repaint_2',
        status: 'draft',
        activeTaskLabel: '进行中',
        currentStage: 'target_settings',
        currentStageStatus: 'waiting_check',
        episodeCount: 2,
        updatedAt: new Date('2026-07-02T00:00:00.000Z'),
      },
    ])

    const result = await listScreenwriterTasks({
      userId: 'user-1',
      taskKind: 'script_repaint_2',
    })

    expect(result.tasks[0]).toMatchObject({
      id: 'sw-script-1',
      taskKind: 'script_repaint_2',
      nextRoute: '/screenwriter/script-repaint/sw-script-1/target-settings',
    })
  })

  it('records approval feedback even when no settings review exists yet', async () => {
    const { approveStage } = await import('@/lib/screenwriter/service')
    const taskRow = {
      id: 'sw-task-1',
      title: 'Demo Task',
      taskKind: 'video_repaint_2',
      status: 'draft',
      activeTaskLabel: '进行中',
      currentStage: 'source_settings',
      currentStageStatus: 'waiting_check',
      episodeCount: 1,
      requirement: 'make it modern',
      updatedAt: new Date('2026-07-02T00:00:00.000Z'),
      sourceVideos: [],
      stageStates: [
        { stageKey: 'auto_split', title: '自动拆集', subtitle: '', status: 'succeeded', checkpoint: null },
        { stageKey: 'fact_extract', title: '事实卡提取', subtitle: '', status: 'succeeded', checkpoint: null },
        { stageKey: 'source_settings', title: '源设定', subtitle: '', status: 'waiting_check', checkpoint: 'A' },
        { stageKey: 'episode_alignment', title: '逐集对齐', subtitle: '', status: 'not_started', checkpoint: null },
        { stageKey: 'target_settings', title: '目标设定', subtitle: '', status: 'not_started', checkpoint: 'B' },
        { stageKey: 'episode_repaint', title: '逐集转绘', subtitle: '', status: 'not_started', checkpoint: null },
      ],
      settingsReviews: [],
      episodeProcesses: [],
      scriptEpisodes: [],
    }
    prismaMock.screenwriterTask.findFirst.mockResolvedValue(taskRow)
    prismaMock.screenwriterTask.update.mockResolvedValue({
      ...taskRow,
      currentStage: 'episode_alignment',
      currentStageStatus: 'running',
    })

    await approveStage({
      userId: 'user-1',
      taskId: 'sw-task-1',
      stage: 'source_settings',
      feedback: 'looks good',
    })

    expect(prismaMock.screenwriterReviewFeedback.create).toHaveBeenCalledWith({
      data: {
        settingsReviewId: null,
        screenwriterTaskId: 'sw-task-1',
        stageKey: 'source_settings',
        content: 'looks good',
        action: 'approve',
        createdBy: 'user-1',
      },
    })
  })

  it('enqueues target settings mock task after approving script repaint source settings', async () => {
    const { approveStage } = await import('@/lib/screenwriter/service')
    const taskRow = {
      id: 'sw-script-1',
      title: 'Script Task',
      taskKind: 'script_repaint_2',
      status: 'draft',
      activeTaskLabel: '进行中',
      currentStage: 'source_settings',
      currentStageStatus: 'waiting_check',
      episodeCount: 1,
      requirement: 'make it modern',
      transferForm: 'script',
      updatedAt: new Date('2026-07-02T00:00:00.000Z'),
      sourceVideos: [],
      stageStates: [
        { stageKey: 'auto_split', title: '自动拆集', subtitle: '', status: 'succeeded', checkpoint: null },
        { stageKey: 'fact_extract', title: '事实卡提取', subtitle: '', status: 'succeeded', checkpoint: null },
        { stageKey: 'source_settings', title: '源设定', subtitle: '', status: 'waiting_check', checkpoint: 'A' },
        { stageKey: 'target_settings', title: '目标设定', subtitle: '', status: 'not_started', checkpoint: 'B' },
        { stageKey: 'episode_repaint', title: '逐集转绘', subtitle: '', status: 'not_started', checkpoint: null },
      ],
      settingsReviews: [{ id: 'review-1', stageKey: 'source_settings', version: 1 }],
      episodeProcesses: [],
      scriptEpisodes: [],
    }
    prismaMock.screenwriterTask.findFirst.mockResolvedValue(taskRow)
    prismaMock.screenwriterTask.update.mockResolvedValue({
      ...taskRow,
      currentStage: 'target_settings',
      currentStageStatus: 'running',
    })

    await approveStage({
      userId: 'user-1',
      taskId: 'sw-script-1',
      stage: 'source_settings',
      feedback: 'looks good',
    })

    expect(producerMock.enqueueScreenwriterMockStage).toHaveBeenCalledWith({
      userId: 'user-1',
      taskId: 'sw-script-1',
      stage: 'target_settings',
    })
  })
})
