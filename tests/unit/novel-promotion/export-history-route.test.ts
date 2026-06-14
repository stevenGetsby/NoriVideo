import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const prismaMock = vi.hoisted(() => ({
  novelPromotionEpisode: {
    findFirst: vi.fn(),
  },
  exportQueueRecord: {
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

const historyStoreMock = vi.hoisted(() => ({
  readExportHistory: vi.fn(),
  appendExportHistoryRecord: vi.fn(async (input: { record: unknown }) => [input.record]),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))

vi.mock('@/lib/api-auth', () => authMock)

vi.mock('@/lib/novel-promotion/export-history-store', () => historyStoreMock)

function postRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/novel-promotion/project-1/export-history?episodeId=%20episode-1%20', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('/api/novel-promotion/[projectId]/export-history', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValue({ id: 'episode-1' })
  })

  it('derives POST records from a ready queue artifact instead of trusting client fields', async () => {
    prismaMock.exportQueueRecord.findFirst.mockResolvedValue({
      id: 'queue-1',
      cardId: 'final-video',
      title: 'Final Video',
      taskId: 'task-1',
      outputFileName: 'server.zip',
      outputStorageKey: 'exports/server.zip',
      outputUrl: 'https://cdn.test/server.zip',
      contentType: 'application/zip',
      stats: {
        clips: 1,
        panels: 2,
        images: 2,
        videos: 1,
        voices: 0,
      },
      finishedAt: new Date('2026-06-13T10:00:00.000Z'),
      updatedAt: new Date('2026-06-13T09:00:00.000Z'),
    })
    const { POST } = await import('@/app/api/novel-promotion/[projectId]/export-history/route')

    const response = await POST(
      postRequest({
        id: 'foreign-history-id',
        cardId: 'final-video',
        title: 'Forged Title',
        fileName: 'forged.zip',
        createdAt: '2000-01-01T00:00:00.000Z',
        stats: { clips: 999, panels: 999, images: 999, videos: 999 },
      }) as never,
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
        episodeId: 'episode-1',
        cardId: 'final-video',
        status: 'ready',
      }),
    }))
    expect(historyStoreMock.appendExportHistoryRecord).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      projectId: 'project-1',
      episodeId: 'episode-1',
      record: expect.objectContaining({
        id: 'task-1-final-video',
        title: 'Final Video',
        fileName: 'server.zip',
        createdAt: '2026-06-13T10:00:00.000Z',
        outputStorageKey: 'exports/server.zip',
      }),
    }))
    expect(JSON.stringify(payload)).not.toContain('Forged Title')
    expect(JSON.stringify(payload)).not.toContain('forged.zip')
    expect(JSON.stringify(payload)).not.toContain('foreign-history-id')
  })

  it('rejects POST when no ready artifact exists for the requested card', async () => {
    prismaMock.exportQueueRecord.findFirst.mockResolvedValue(null)
    const { POST } = await import('@/app/api/novel-promotion/[projectId]/export-history/route')

    const response = await POST(
      postRequest({ cardId: 'final-video' }) as never,
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )
    const payload = await response.json()

    expect(response.status).toBe(409)
    expect(payload.error?.details).toMatchObject({
      code: 'EXPORT_HISTORY_READY_ARTIFACT_REQUIRED',
      field: 'cardId',
    })
    expect(historyStoreMock.appendExportHistoryRecord).not.toHaveBeenCalled()
  })

  it('returns not found before queue lookup for an episode outside the project', async () => {
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValue(null)
    const { POST } = await import('@/app/api/novel-promotion/[projectId]/export-history/route')

    const response = await POST(
      postRequest({ cardId: 'final-video' }) as never,
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(response.status).toBe(404)
    expect(prismaMock.exportQueueRecord.findFirst).not.toHaveBeenCalled()
    expect(historyStoreMock.appendExportHistoryRecord).not.toHaveBeenCalled()
  })
})
