import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const prismaMock = vi.hoisted(() => ({
  novelPromotionEpisode: {
    findFirst: vi.fn(),
  },
  exportQueueRecord: {
    findFirst: vi.fn(),
  },
  exportHistoryRecord: {
    findFirst: vi.fn(),
  },
}))

const authMock = vi.hoisted(() => ({
  requireProjectAuthLight: vi.fn(async () => ({
    session: { user: { id: 'user-1' } },
    project: { id: 'project-1', userId: 'user-1', name: 'Project' },
  })),
  isErrorResponse: (value: unknown) => value instanceof NextResponse,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))

vi.mock('@/lib/api-auth', () => authMock)

vi.mock('@/lib/storage', () => ({
  getSignedUrl: (key: string) => `https://signed.test/${encodeURIComponent(key)}`,
}))

function getRequest(query: string) {
  return new NextRequest(`http://localhost/api/novel-promotion/project-1/export-artifact${query}`, {
    method: 'GET',
  })
}

describe('/api/novel-promotion/[projectId]/export-artifact episode scope', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValue({ id: 'episode-1' })
    prismaMock.exportQueueRecord.findFirst.mockResolvedValue({
      id: 'queue-1',
      cardId: 'final-video',
      taskId: 'task-1',
      outputFileName: 'final.zip',
      contentType: 'application/zip',
      outputStorageKey: 'exports/final.zip',
      outputUrl: null,
      status: 'ready',
      createdAt: new Date('2026-06-14T01:00:00.000Z'),
      updatedAt: new Date('2026-06-14T02:00:00.000Z'),
    })
  })

  it('validates and trims episode scope before returning queue artifact metadata', async () => {
    const { GET } = await import('@/app/api/novel-promotion/[projectId]/export-artifact/route')

    const response = await GET(
      getRequest('?episodeId=%20episode-1%20&cardId=final-video') as never,
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(prismaMock.novelPromotionEpisode.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'episode-1',
        novelPromotionProject: { projectId: 'project-1' },
      },
      select: { id: true },
    })
    expect(prismaMock.exportQueueRecord.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        userId: 'user-1',
        projectId: 'project-1',
        scopeId: 'episode-1',
        cardId: 'final-video',
      }),
    }))
    expect(payload).toMatchObject({
      projectId: 'project-1',
      episodeId: 'episode-1',
      source: 'queue',
      id: 'queue-1',
      cardId: 'final-video',
      downloadUrl: 'https://signed.test/exports%2Ffinal.zip',
    })
  })

  it('returns not found before artifact lookup for an episode outside the project', async () => {
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValue(null)
    const { GET } = await import('@/app/api/novel-promotion/[projectId]/export-artifact/route')

    const response = await GET(
      getRequest('?episodeId=episode-other&cardId=final-video') as never,
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(response.status).toBe(404)
    expect(prismaMock.exportQueueRecord.findFirst).not.toHaveBeenCalled()
    expect(prismaMock.exportHistoryRecord.findFirst).not.toHaveBeenCalled()
  })
})
