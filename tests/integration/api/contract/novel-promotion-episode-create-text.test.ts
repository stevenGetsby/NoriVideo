import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Prisma } from '@prisma/client'
import { buildMockRequest } from '../../../helpers/request'

const authMock = vi.hoisted(() => ({
  requireProjectAuth: vi.fn(async () => ({
    novelData: { id: 'np-1', projectId: 'project-1', importStatus: 'pending', pendingImportText: '第一章内容', pendingImportEpisodeName: null },
  })),
  isErrorResponse: vi.fn((value: unknown) => value instanceof Response),
}))

const prismaMock = vi.hoisted(() => ({
  novelPromotionEpisode: {
    findFirst: vi.fn(async () => null),
    create: vi.fn(async () => ({
      id: 'episode-1',
      novelPromotionProjectId: 'np-1',
      episodeNumber: 1,
      name: '第 1 集',
      description: null,
      novelText: '第一章内容',
    })),
  },
  novelPromotionProject: {
    update: vi.fn(async () => ({
      id: 'np-1',
      lastEpisodeId: 'episode-1',
    })),
  },
}))

vi.mock('@/lib/api-auth', () => authMock)
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

describe('api specific - novel promotion episode create text', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValue(null)
    prismaMock.novelPromotionEpisode.create.mockResolvedValue({
      id: 'episode-1',
      novelPromotionProjectId: 'np-1',
      episodeNumber: 1,
      name: '第 1 集',
      description: null,
      novelText: '第一章内容',
    })
    prismaMock.novelPromotionProject.update.mockResolvedValue({
      id: 'np-1',
      lastEpisodeId: 'episode-1',
    })
  })

  it('persists novelText when creating the first episode from home launch', async () => {
    const mod = await import('@/app/api/novel-promotion/[projectId]/episodes/route')
    const req = buildMockRequest({
      path: '/api/novel-promotion/project-1/episodes',
      method: 'POST',
      body: {
        name: '第 1 集',
        novelText: '第一章内容',
      },
    })

    const res = await mod.POST(req, { params: Promise.resolve({ projectId: 'project-1' }) })

    expect(res.status).toBe(201)
    expect(prismaMock.novelPromotionEpisode.create).toHaveBeenCalledWith({
      data: {
        novelPromotionProjectId: 'np-1',
        episodeNumber: 1,
        name: '第 1 集',
        description: null,
        novelText: '第一章内容',
      },
    })
    expect(prismaMock.novelPromotionProject.update).toHaveBeenCalledWith({
      where: { id: 'np-1' },
      data: {
        lastEpisodeId: 'episode-1',
        importStatus: 'completed',
        pendingImportText: null,
        pendingImportEpisodeName: null,
      },
    })
  })

  it('retries with the next episode number when concurrent creation hits a unique constraint', async () => {
    const uniqueError = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed',
      { code: 'P2002', clientVersion: 'test' },
    )
    prismaMock.novelPromotionEpisode.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'episode-1', episodeNumber: 1 } as never)
    prismaMock.novelPromotionEpisode.create
      .mockRejectedValueOnce(uniqueError)
      .mockResolvedValueOnce({
        id: 'episode-2',
        novelPromotionProjectId: 'np-1',
        episodeNumber: 2,
        name: '第 1 集',
        description: null,
        novelText: '第一章内容',
      })

    const mod = await import('@/app/api/novel-promotion/[projectId]/episodes/route')
    const req = buildMockRequest({
      path: '/api/novel-promotion/project-1/episodes',
      method: 'POST',
      body: {
        name: '第 1 集',
        novelText: '第一章内容',
      },
    })

    const res = await mod.POST(req, { params: Promise.resolve({ projectId: 'project-1' }) })

    expect(res.status).toBe(201)
    expect(prismaMock.novelPromotionEpisode.create).toHaveBeenNthCalledWith(1, {
      data: {
        novelPromotionProjectId: 'np-1',
        episodeNumber: 1,
        name: '第 1 集',
        description: null,
        novelText: '第一章内容',
      },
    })
    expect(prismaMock.novelPromotionEpisode.create).toHaveBeenNthCalledWith(2, {
      data: {
        novelPromotionProjectId: 'np-1',
        episodeNumber: 2,
        name: '第 1 集',
        description: null,
        novelText: '第一章内容',
      },
    })
    expect(prismaMock.novelPromotionProject.update).toHaveBeenCalledWith({
      where: { id: 'np-1' },
      data: {
        lastEpisodeId: 'episode-2',
        importStatus: 'completed',
        pendingImportText: null,
        pendingImportEpisodeName: null,
      },
    })
  })
})
