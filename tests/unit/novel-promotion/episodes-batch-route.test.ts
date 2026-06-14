import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const authMock = vi.hoisted(() => ({
  requireProjectAuthLight: vi.fn(async () => ({
    project: { id: 'project-1' },
  })),
  isErrorResponse: (value: unknown) => value instanceof NextResponse,
}))

const prismaMock = vi.hoisted(() => ({
  novelPromotionProject: {
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  novelPromotionEpisode: {
    deleteMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
  },
  $transaction: vi.fn(),
}))

vi.mock('@/lib/api-auth', () => authMock)
vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))

function request(body: unknown) {
  return new NextRequest('http://localhost/api/novel-promotion/project-1/episodes/batch', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('/api/novel-promotion/[projectId]/episodes/batch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.novelPromotionProject.findFirst.mockResolvedValue({
      id: 'np-1',
      projectId: 'project-1',
      importStatus: 'pending',
      pendingImportText: 'draft text',
      pendingImportEpisodeName: 'Draft episode',
    })
    prismaMock.novelPromotionEpisode.deleteMany.mockResolvedValue({ count: 0 })
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValue(null)
    prismaMock.novelPromotionEpisode.create.mockImplementation(async ({ data }) => ({
      id: `episode-${data.episodeNumber}`,
      ...data,
    }))
    prismaMock.$transaction.mockImplementation(async (operations: Array<Promise<unknown>>) => Promise.all(operations))
  })

  it('does not let an empty batch mark pending import as completed', async () => {
    const { POST } = await import('@/app/api/novel-promotion/[projectId]/episodes/batch/route')

    const response = await POST(
      request({ episodes: [], importStatus: 'completed' }) as never,
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.episodes).toEqual([])
    expect(prismaMock.novelPromotionProject.update).not.toHaveBeenCalled()
  })

  it('derives completed import status after creating episodes and clears pending draft', async () => {
    const { POST } = await import('@/app/api/novel-promotion/[projectId]/episodes/batch/route')

    const response = await POST(
      request({
        episodes: [
          {
            name: '第 1 集',
            description: 'summary',
            novelText: 'episode text',
          },
        ],
        clearExisting: true,
        importStatus: 'pending',
      }) as never,
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.episodes).toEqual([
      {
        id: 'episode-1',
        episodeNumber: 1,
        name: '第 1 集',
      },
    ])
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
})
