import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../helpers/request'

const authMock = vi.hoisted(() => ({
  requireProjectAuthLight: vi.fn(async (projectId: string) => ({
    session: { user: { id: 'user-1' } },
    project: { id: projectId, userId: 'user-1' },
  })),
  isErrorResponse: (value: unknown) => value instanceof Response,
}))

const retryStageMock = vi.hoisted(() => vi.fn())
const prismaMock = vi.hoisted(() => ({
  novelPromotionEpisode: {
    findFirst: vi.fn(),
  },
}))

vi.mock('@/lib/api-auth', () => authMock)
vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))
vi.mock('@/lib/workflow/run-stage', () => ({
  retryStage: retryStageMock,
}))

describe('/api/workflow/projects/[projectId]/stages/[stage]/retry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValue({ id: 'episode-1' })
    retryStageMock.mockResolvedValue({
      stage: 'storyboard',
      status: 'queued',
      taskId: 'task-new',
      runId: 'run-new',
      deduped: false,
      retried: true,
      previousStatus: 'failed',
      previousTaskId: 'task-old',
      previousRunId: 'run-old',
    })
  })

  it('retries a workflow stage through the shared stage runner', async () => {
    const { POST } = await import('@/app/api/workflow/projects/[projectId]/stages/[stage]/retry/route')

    const response = await POST(
      buildMockRequest({
        path: '/api/workflow/projects/project-1/stages/storyboard/retry',
        method: 'POST',
        headers: { 'x-locale': 'en' },
        body: {
          episodeId: '  episode-1  ',
          input: { reason: 'manual retry' },
        },
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
    expect(retryStageMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      projectId: 'project-1',
      stage: 'storyboard',
      locale: 'en',
      episodeId: 'episode-1',
      input: { reason: 'manual retry' },
    }))
    expect(payload).toMatchObject({
      success: true,
      stage: 'storyboard',
      status: 'queued',
      taskId: 'task-new',
      retried: true,
      previousStatus: 'failed',
      previousTaskId: 'task-old',
    })
  })

  it('rejects invalid workflow stage keys before auth and retry', async () => {
    const { POST } = await import('@/app/api/workflow/projects/[projectId]/stages/[stage]/retry/route')

    const response = await POST(
      buildMockRequest({
        path: '/api/workflow/projects/project-1/stages/not-a-stage/retry',
        method: 'POST',
        body: {},
      }),
      { params: Promise.resolve({ projectId: 'project-1', stage: 'not-a-stage' }) },
    )

    expect(response.status).toBe(400)
    expect(authMock.requireProjectAuthLight).not.toHaveBeenCalled()
    expect(retryStageMock).not.toHaveBeenCalled()
  })
})
