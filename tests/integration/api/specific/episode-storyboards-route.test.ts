import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../../helpers/request'

const authMock = vi.hoisted(() => ({
  requireUserAuth: vi.fn(async () => ({
    session: { user: { id: 'user-1' } },
  })),
  isErrorResponse: vi.fn((value: unknown) => value instanceof Response),
}))

const prismaMock = vi.hoisted(() => ({
  novelPromotionEpisode: {
    findUnique: vi.fn(),
  },
  novelPromotionStoryboard: {
    findMany: vi.fn(),
  },
}))

const attachMediaFieldsToProjectMock = vi.hoisted(() =>
  vi.fn(async (value: unknown) => value),
)

vi.mock('@/lib/api-auth', () => authMock)
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/media/attach', () => ({
  attachMediaFieldsToProject: attachMediaFieldsToProjectMock,
}))

describe('api specific - episode storyboards route', () => {
  const routeContext = { params: Promise.resolve({ episodeId: 'episode-1' }) }

  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.novelPromotionEpisode.findUnique.mockResolvedValue({
      id: 'episode-1',
      novelPromotionProject: {
        project: { userId: 'user-1' },
      },
    })
    prismaMock.novelPromotionStoryboard.findMany.mockResolvedValue([
      {
        id: 'storyboard-1',
        clipId: 'clip-1',
        clip: { id: 'clip-1', summary: 'Clip summary' },
        panels: [
          {
            id: 'panel-1',
            panelIndex: 0,
            imageUrl: null,
            videoUrl: null,
            videoPrompt: 'motion prompt',
            srtSegment: 'voice text',
            imagePrompt: 'image prompt',
          },
        ],
      },
    ])
  })

  it('returns storyboards and hook-compatible groups for the episode owner', async () => {
    const mod = await import('@/app/api/novel-promotion/episodes/[episodeId]/storyboards/route')
    const req = buildMockRequest({
      path: '/api/novel-promotion/episodes/episode-1/storyboards',
      method: 'GET',
    })

    const res = await mod.GET(req, routeContext)
    const body = await res.json() as {
      storyboards?: unknown[]
      groups?: Array<{ id?: string; panels?: Array<{ id?: string; imagePrompt?: string | null }> }>
    }

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/json')
    expect(body.storyboards).toHaveLength(1)
    expect(body.groups).toHaveLength(1)
    expect(body.groups?.[0]?.id).toBe('storyboard-1')
    expect(body.groups?.[0]?.panels?.[0]?.id).toBe('panel-1')
    expect(body.groups?.[0]?.panels?.[0]?.imagePrompt).toBe('image prompt')
    expect(prismaMock.novelPromotionEpisode.findUnique).toHaveBeenCalledWith({
      where: { id: 'episode-1' },
      select: {
        id: true,
        novelPromotionProject: {
          select: {
            project: {
              select: { userId: true },
            },
          },
        },
      },
    })
    expect(attachMediaFieldsToProjectMock).toHaveBeenCalled()
  })

  it('returns forbidden when the episode belongs to another user', async () => {
    prismaMock.novelPromotionEpisode.findUnique.mockResolvedValueOnce({
      id: 'episode-1',
      novelPromotionProject: {
        project: { userId: 'other-user' },
      },
    })

    const mod = await import('@/app/api/novel-promotion/episodes/[episodeId]/storyboards/route')
    const req = buildMockRequest({
      path: '/api/novel-promotion/episodes/episode-1/storyboards',
      method: 'GET',
    })

    const res = await mod.GET(req, routeContext)
    const body = await res.json() as { error?: { code?: string } }

    expect(res.status).toBe(403)
    expect(body.error?.code).toBe('FORBIDDEN')
    expect(prismaMock.novelPromotionStoryboard.findMany).not.toHaveBeenCalled()
  })
})
