import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../helpers/request'

const authMock = vi.hoisted(() => ({
  requireProjectAuthLight: vi.fn(async (projectId: string) => ({
    session: { user: { id: 'user-1' } },
    project: { id: projectId, userId: 'user-1' },
  })),
  isErrorResponse: (value: unknown) => value instanceof Response,
}))

const prismaMock = vi.hoisted(() => ({
  novelPromotionEpisode: {
    findFirst: vi.fn(),
  },
  workflowStageState: {
    findMany: vi.fn(),
  },
}))

vi.mock('@/lib/api-auth', () => authMock)
vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))

describe('/api/workflow/projects/[projectId]/stages', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValue({ id: 'episode-1' })
    prismaMock.workflowStageState.findMany.mockResolvedValue([])
  })

  it('returns all workflow stages with persisted runtime details', async () => {
    prismaMock.workflowStageState.findMany.mockResolvedValue([
      {
        stageKey: 'config',
        status: 'approved',
        reviewState: 'confirmed',
        progress: 100,
        blocker: null,
        lastRunId: 'run-config',
        lastTaskId: 'task-config',
        summary: { stage: 'config' },
        errorCode: null,
        errorMessage: null,
        updatedAt: new Date('2026-06-14T01:00:00.000Z'),
      },
      {
        stageKey: 'script',
        status: 'failed',
        reviewState: 'review',
        progress: 42,
        blocker: 'provider failed',
        lastRunId: 'run-script',
        lastTaskId: 'task-script',
        summary: { flowStageTitle: 'script' },
        errorCode: 'PROVIDER_FAILED',
        errorMessage: 'provider failed',
        updatedAt: new Date('2026-06-14T02:00:00.000Z'),
      },
    ])
    const { GET } = await import('@/app/api/workflow/projects/[projectId]/stages/route')

    const response = await GET(
      buildMockRequest({
        path: '/api/workflow/projects/project-1/stages',
        method: 'GET',
        query: { episodeId: '  episode-1  ' },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(prismaMock.novelPromotionEpisode.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'episode-1',
        novelPromotionProject: {
          projectId: 'project-1',
        },
      },
      select: { id: true },
    })
    expect(prismaMock.workflowStageState.findMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        projectId: 'project-1',
        scopeId: 'episode-1',
      },
      select: {
        stageKey: true,
        status: true,
        reviewState: true,
        progress: true,
        blocker: true,
        lastRunId: true,
        lastTaskId: true,
        summary: true,
        errorCode: true,
        errorMessage: true,
        updatedAt: true,
      },
    })
    expect(payload.scopeId).toBe('episode-1')
    expect(payload.activeStage).toBe('script')
    expect(payload.stages.find((stage: { stage: string }) => stage.stage === 'script')).toMatchObject({
      stage: 'script',
      label: '资产设定',
      status: 'failed',
      locked: false,
      readonly: false,
      stale: false,
      reviewState: 'review',
      progress: 42,
      blocker: 'provider failed',
      lastRunId: 'run-script',
      lastTaskId: 'task-script',
      errorCode: 'PROVIDER_FAILED',
      errorMessage: 'provider failed',
      summary: { flowStageTitle: 'script' },
      updatedAt: '2026-06-14T02:00:00.000Z',
    })
  })

  it('keeps the stages list compatible when no persisted rows exist', async () => {
    const { GET } = await import('@/app/api/workflow/projects/[projectId]/stages/route')

    const response = await GET(
      buildMockRequest({
        path: '/api/workflow/projects/project-1/stages',
        method: 'GET',
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toMatchObject({
      projectId: 'project-1',
      episodeId: null,
      scopeId: 'project',
      activeStage: 'config',
    })
    expect(payload.stages[0]).toMatchObject({
      stage: 'config',
      status: 'idle',
      reviewState: null,
      progress: null,
      blocker: null,
      lastRunId: null,
      lastTaskId: null,
      errorCode: null,
      errorMessage: null,
      summary: null,
      updatedAt: null,
    })
  })

  it('returns not found before reading workflow states for an episode outside the project', async () => {
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValue(null)
    const { GET } = await import('@/app/api/workflow/projects/[projectId]/stages/route')

    const response = await GET(
      buildMockRequest({
        path: '/api/workflow/projects/project-1/stages',
        method: 'GET',
        query: { episodeId: '  episode-other  ' },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(response.status).toBe(404)
    expect(prismaMock.novelPromotionEpisode.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'episode-other',
        novelPromotionProject: {
          projectId: 'project-1',
        },
      },
      select: { id: true },
    })
    expect(prismaMock.workflowStageState.findMany).not.toHaveBeenCalled()
  })
})
