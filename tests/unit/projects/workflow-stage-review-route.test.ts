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

const readWorkflowStageReviewWithMetaMock = vi.hoisted(() => vi.fn(async () => ({
  source: 'database',
  updatedAt: '2026-06-14T00:00:00.000Z',
  states: { script: 'confirmed' },
})))

const writeWorkflowStageReviewMock = vi.hoisted(() => vi.fn(async (input: { states: Record<string, string> }) => ({
  source: 'database',
  updatedAt: '2026-06-14T00:00:00.000Z',
  states: input.states,
})))

vi.mock('@/lib/api-auth', () => authMock)
vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))
vi.mock('@/lib/workspace/workflow-stage-review-store', () => ({
  readWorkflowStageReviewWithMeta: readWorkflowStageReviewWithMetaMock,
  writeWorkflowStageReview: writeWorkflowStageReviewMock,
}))

describe('/api/projects/[projectId]/workflow-stage-review', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValue({ id: 'episode-1' })
  })

  it('normalizes episodeId before reading review state', async () => {
    const { GET } = await import('@/app/api/projects/[projectId]/workflow-stage-review/route')

    const res = await GET(
      buildMockRequest({
        path: '/api/projects/project-1/workflow-stage-review',
        method: 'GET',
        query: { episodeId: '  episode-1  ' },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )
    const body = await res.json() as { episodeId?: string | null }

    expect(res.status).toBe(200)
    expect(body.episodeId).toBe('episode-1')
    expect(prismaMock.novelPromotionEpisode.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'episode-1',
        novelPromotionProject: {
          projectId: 'project-1',
        },
      },
      select: { id: true },
    })
    expect(readWorkflowStageReviewWithMetaMock).toHaveBeenCalledWith({
      userId: 'user-1',
      projectId: 'project-1',
      episodeId: 'episode-1',
    })
  })

  it('returns not found before reading review state for an episode outside the project', async () => {
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValueOnce(null)
    const { GET } = await import('@/app/api/projects/[projectId]/workflow-stage-review/route')

    const res = await GET(
      buildMockRequest({
        path: '/api/projects/project-1/workflow-stage-review',
        method: 'GET',
        query: { episodeId: 'episode-other' },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(res.status).toBe(404)
    expect(readWorkflowStageReviewWithMetaMock).not.toHaveBeenCalled()
  })

  it('returns not found before writing review state for an episode outside the project', async () => {
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValueOnce(null)
    const { PUT } = await import('@/app/api/projects/[projectId]/workflow-stage-review/route')

    const res = await PUT(
      buildMockRequest({
        path: '/api/projects/project-1/workflow-stage-review',
        method: 'PUT',
        query: { episodeId: 'episode-other' },
        body: { states: { script: 'confirmed' } },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(res.status).toBe(404)
    expect(writeWorkflowStageReviewMock).not.toHaveBeenCalled()
  })
})
