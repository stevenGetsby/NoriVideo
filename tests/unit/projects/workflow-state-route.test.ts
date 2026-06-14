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
  novelPromotionProject: {
    findUnique: vi.fn(),
  },
  workflowStageState: {
    findMany: vi.fn(),
  },
}))

const readWorkflowStageReviewWithMetaMock = vi.hoisted(() => vi.fn(async () => ({
  source: 'database',
  updatedAt: '2026-06-14T00:00:00.000Z',
  states: {},
})))

vi.mock('@/lib/api-auth', () => authMock)
vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))
vi.mock('@/lib/workspace/workflow-stage-review-store', () => ({
  readWorkflowStageReviewWithMeta: readWorkflowStageReviewWithMetaMock,
}))

function buildNovelData(episodes: unknown[]) {
  return {
    id: 'novel-project-1',
    projectId: 'project-1',
    characters: [],
    locations: [],
    episodes,
  }
}

describe('/api/projects/[projectId]/workflow-state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.novelPromotionProject.findUnique.mockResolvedValue(buildNovelData([
      {
        id: 'episode-1',
        novelText: 'story',
        clips: [],
        storyboards: [],
        voiceLines: [],
        editorProject: null,
      },
    ]))
    prismaMock.workflowStageState.findMany.mockResolvedValue([])
  })

  it('normalizes episodeId before querying stage review and runtime scope', async () => {
    const { GET } = await import('@/app/api/projects/[projectId]/workflow-state/route')

    const res = await GET(
      buildMockRequest({
        path: '/api/projects/project-1/workflow-state',
        method: 'GET',
        query: { episodeId: '  episode-1  ' },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )
    const body = await res.json() as { episodeId?: string | null }

    expect(res.status).toBe(200)
    expect(body.episodeId).toBe('episode-1')
    expect(prismaMock.novelPromotionProject.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { projectId: 'project-1' },
      include: expect.objectContaining({
        episodes: expect.objectContaining({
          where: { id: 'episode-1' },
        }),
      }),
    }))
    expect(readWorkflowStageReviewWithMetaMock).toHaveBeenCalledWith({
      userId: 'user-1',
      projectId: 'project-1',
      episodeId: 'episode-1',
    })
    expect(prismaMock.workflowStageState.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        userId: 'user-1',
        projectId: 'project-1',
        scopeId: 'episode-1',
      }),
    }))
  })

  it('returns not found for an episode id outside the current project', async () => {
    prismaMock.novelPromotionProject.findUnique.mockResolvedValueOnce(buildNovelData([]))
    const { GET } = await import('@/app/api/projects/[projectId]/workflow-state/route')

    const res = await GET(
      buildMockRequest({
        path: '/api/projects/project-1/workflow-state',
        method: 'GET',
        query: { episodeId: 'episode-other' },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(res.status).toBe(404)
    expect(readWorkflowStageReviewWithMetaMock).not.toHaveBeenCalled()
    expect(prismaMock.workflowStageState.findMany).not.toHaveBeenCalled()
  })
})
