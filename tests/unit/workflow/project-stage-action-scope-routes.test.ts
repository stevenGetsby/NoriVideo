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
}))

const stageActionMocks = vi.hoisted(() => ({
  runStage: vi.fn(),
  approveStage: vi.fn(),
  unapproveStage: vi.fn(),
  cancelStage: vi.fn(),
  retryStage: vi.fn(),
}))

vi.mock('@/lib/api-auth', () => authMock)
vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))
vi.mock('@/lib/workflow/run-stage', () => stageActionMocks)

describe('/api/workflow/projects/[projectId]/stages/[stage] action scope', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValue({ id: 'episode-1' })
    stageActionMocks.runStage.mockResolvedValue({ stage: 'storyboard', status: 'queued', taskId: 'task-1' })
    stageActionMocks.approveStage.mockResolvedValue({ stage: 'storyboard', status: 'approved' })
    stageActionMocks.unapproveStage.mockResolvedValue({ stage: 'storyboard', status: 'idle' })
    stageActionMocks.cancelStage.mockResolvedValue({ stage: 'storyboard', status: 'canceled' })
    stageActionMocks.retryStage.mockResolvedValue({ stage: 'storyboard', status: 'queued', taskId: 'task-retry' })
  })

  it('normalizes episode scope before running a stage', async () => {
    const { POST } = await import('@/app/api/workflow/projects/[projectId]/stages/[stage]/run/route')

    const response = await POST(
      buildMockRequest({
        path: '/api/workflow/projects/project-1/stages/storyboard/run',
        method: 'POST',
        headers: { 'x-locale': 'en', 'x-request-id': 'request-1' },
        body: {
          episodeId: '  episode-1  ',
          input: { panelCount: 3 },
          options: { force: true },
        },
      }),
      { params: Promise.resolve({ projectId: 'project-1', stage: 'storyboard' }) },
    )

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
    expect(stageActionMocks.runStage).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      projectId: 'project-1',
      stage: 'storyboard',
      locale: 'en',
      episodeId: 'episode-1',
      input: { panelCount: 3 },
      force: true,
      requestId: 'request-1',
    }))
  })

  it('rejects missing or cross-project episode scope before stage mutations', async () => {
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValue(null)

    const routeCases = [
      {
        path: '/api/workflow/projects/project-1/stages/storyboard/run',
        importRoute: async () => await import('@/app/api/workflow/projects/[projectId]/stages/[stage]/run/route'),
        action: stageActionMocks.runStage,
      },
      {
        path: '/api/workflow/projects/project-1/stages/storyboard/approve',
        importRoute: async () => await import('@/app/api/workflow/projects/[projectId]/stages/[stage]/approve/route'),
        action: stageActionMocks.approveStage,
      },
      {
        path: '/api/workflow/projects/project-1/stages/storyboard/unapprove',
        importRoute: async () => await import('@/app/api/workflow/projects/[projectId]/stages/[stage]/unapprove/route'),
        action: stageActionMocks.unapproveStage,
      },
      {
        path: '/api/workflow/projects/project-1/stages/storyboard/cancel',
        importRoute: async () => await import('@/app/api/workflow/projects/[projectId]/stages/[stage]/cancel/route'),
        action: stageActionMocks.cancelStage,
      },
      {
        path: '/api/workflow/projects/project-1/stages/storyboard/retry',
        importRoute: async () => await import('@/app/api/workflow/projects/[projectId]/stages/[stage]/retry/route'),
        action: stageActionMocks.retryStage,
      },
    ]

    for (const routeCase of routeCases) {
      const { POST } = await routeCase.importRoute()
      const response = await POST(
        buildMockRequest({
          path: routeCase.path,
          method: 'POST',
          body: { episodeId: '  episode-other  ' },
        }),
        { params: Promise.resolve({ projectId: 'project-1', stage: 'storyboard' }) },
      )

      expect(response.status).toBe(404)
      expect(routeCase.action).not.toHaveBeenCalled()
    }
  })
})
