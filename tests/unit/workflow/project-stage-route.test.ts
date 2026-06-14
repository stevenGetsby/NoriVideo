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

describe('/api/workflow/projects/[projectId]/stages/[stage]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValue({ id: 'episode-1' })
    prismaMock.workflowStageState.findMany.mockResolvedValue([])
  })

  it('returns a single persisted workflow stage runtime view', async () => {
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
        status: 'approved',
        reviewState: 'confirmed',
        progress: 100,
        blocker: null,
        lastRunId: 'run-script',
        lastTaskId: 'task-script',
        summary: { stage: 'script' },
        errorCode: null,
        errorMessage: null,
        updatedAt: new Date('2026-06-14T01:30:00.000Z'),
      },
      {
        stageKey: 'storyboard',
        status: 'running',
        reviewState: null,
        progress: 64,
        blocker: null,
        lastRunId: 'run-storyboard',
        lastTaskId: 'task-storyboard',
        summary: { flowStageTitle: 'storyboard', message: 'generating panels' },
        errorCode: null,
        errorMessage: null,
        updatedAt: new Date('2026-06-14T02:00:00.000Z'),
      },
    ])
    const { GET } = await import('@/app/api/workflow/projects/[projectId]/stages/[stage]/route')

    const response = await GET(
      buildMockRequest({
        path: '/api/workflow/projects/project-1/stages/storyboard',
        method: 'GET',
        query: { episodeId: '  episode-1  ' },
      }),
      { params: Promise.resolve({ projectId: 'project-1', stage: 'storyboard' }) },
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
    expect(payload).toMatchObject({
      projectId: 'project-1',
      episodeId: 'episode-1',
      scopeId: 'episode-1',
      stage: {
        stage: 'storyboard',
        label: '分镜设计',
        status: 'running',
        locked: false,
        readonly: true,
        stale: false,
        reviewState: null,
        progress: 64,
        blocker: null,
        lastRunId: 'run-storyboard',
        lastTaskId: 'task-storyboard',
        errorCode: null,
        errorMessage: null,
        summary: { flowStageTitle: 'storyboard', message: 'generating panels' },
        updatedAt: '2026-06-14T02:00:00.000Z',
      },
    })
  })

  it('returns an idle single stage view when no persisted row exists', async () => {
    const { GET } = await import('@/app/api/workflow/projects/[projectId]/stages/[stage]/route')

    const response = await GET(
      buildMockRequest({
        path: '/api/workflow/projects/project-1/stages/config',
        method: 'GET',
      }),
      { params: Promise.resolve({ projectId: 'project-1', stage: 'config' }) },
    )
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.scopeId).toBe('project')
    expect(payload.stage).toMatchObject({
      stage: 'config',
      status: 'idle',
      locked: false,
      readonly: false,
      stale: false,
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

  it('rejects invalid workflow stage keys before auth and storage reads', async () => {
    const { GET } = await import('@/app/api/workflow/projects/[projectId]/stages/[stage]/route')

    const response = await GET(
      buildMockRequest({
        path: '/api/workflow/projects/project-1/stages/not-a-stage',
        method: 'GET',
      }),
      { params: Promise.resolve({ projectId: 'project-1', stage: 'not-a-stage' }) },
    )

    expect(response.status).toBe(400)
    expect(authMock.requireProjectAuthLight).not.toHaveBeenCalled()
    expect(prismaMock.workflowStageState.findMany).not.toHaveBeenCalled()
  })
})
