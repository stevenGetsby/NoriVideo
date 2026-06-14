import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../helpers/request'

const authMock = vi.hoisted(() => ({
  requireProjectAuthLight: vi.fn(async (projectId: string) => ({
    session: { user: { id: 'user-1' } },
    project: { id: projectId, userId: 'user-1' },
  })),
  isErrorResponse: (value: unknown) => value instanceof Response,
}))

const readEpisodeRebuildImpactMock = vi.hoisted(() => vi.fn(async (input: {
  userId: string
  projectId: string
  episodeId: string
}): Promise<{
  userId: string
  projectId: string
  episodeId: string
  source: 'server'
  updatedAt: string
  shouldConfirm: boolean
  counts: {
    storyboardCount: number
    panelCount: number
    imageCount: number
    videoCount: number
    voiceLineCount: number
    voiceAudioCount: number
    editorProjectCount: number
    exportQueueCount: number
    exportHistoryCount: number
    activeTaskCount: number
  }
} | null> => ({
  userId: input.userId,
  projectId: input.projectId,
  episodeId: input.episodeId,
  source: 'server',
  updatedAt: '2026-06-14T00:00:00.000Z',
  shouldConfirm: false,
  counts: {
    storyboardCount: 0,
    panelCount: 0,
    imageCount: 0,
    videoCount: 0,
    voiceLineCount: 0,
    voiceAudioCount: 0,
    editorProjectCount: 0,
    exportQueueCount: 0,
    exportHistoryCount: 0,
    activeTaskCount: 0,
  },
})))

vi.mock('@/lib/api-auth', () => authMock)
vi.mock('@/lib/novel-promotion/rebuild-impact', () => ({
  readEpisodeRebuildImpact: readEpisodeRebuildImpactMock,
}))

describe('/api/novel-promotion/[projectId]/rebuild-impact', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('normalizes episodeId before reading persisted impact', async () => {
    const { GET } = await import('@/app/api/novel-promotion/[projectId]/rebuild-impact/route')

    const res = await GET(
      buildMockRequest({
        path: '/api/novel-promotion/project-1/rebuild-impact',
        method: 'GET',
        query: { episodeId: '  episode-1  ' },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )
    const body = await res.json() as { episodeId?: string }

    expect(res.status).toBe(200)
    expect(body.episodeId).toBe('episode-1')
    expect(readEpisodeRebuildImpactMock).toHaveBeenCalledWith({
      userId: 'user-1',
      projectId: 'project-1',
      episodeId: 'episode-1',
    })
  })

  it('rejects blank episodeId before reading impact', async () => {
    const { GET } = await import('@/app/api/novel-promotion/[projectId]/rebuild-impact/route')

    const res = await GET(
      buildMockRequest({
        path: '/api/novel-promotion/project-1/rebuild-impact',
        method: 'GET',
        query: { episodeId: '   ' },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(res.status).toBe(400)
    expect(readEpisodeRebuildImpactMock).not.toHaveBeenCalled()
  })

  it('returns not found when normalized episode does not belong to the project', async () => {
    readEpisodeRebuildImpactMock.mockResolvedValueOnce(null)
    const { GET } = await import('@/app/api/novel-promotion/[projectId]/rebuild-impact/route')

    const res = await GET(
      buildMockRequest({
        path: '/api/novel-promotion/project-1/rebuild-impact',
        method: 'GET',
        query: { episodeId: ' episode-other ' },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(res.status).toBe(404)
    expect(readEpisodeRebuildImpactMock).toHaveBeenCalledWith({
      userId: 'user-1',
      projectId: 'project-1',
      episodeId: 'episode-other',
    })
  })
})
