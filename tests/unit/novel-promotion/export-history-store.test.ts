import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  exportHistoryRecord: {
    createMany: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    upsert: vi.fn(),
  },
}))

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))

vi.mock('@/lib/storage', () => ({
  getSignedUrl: vi.fn((key: string) => `signed:${key}`),
}))

describe('export history store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not allow an existing history id to be reassigned across users or projects', async () => {
    prismaMock.exportHistoryRecord.findUnique.mockResolvedValue({
      userId: 'other-user',
      projectId: 'other-project',
      scopeId: 'episode-1',
    })
    const { appendExportHistoryRecord } = await import('@/lib/novel-promotion/export-history-store')

    await expect(appendExportHistoryRecord({
      userId: 'user-1',
      projectId: 'project-1',
      episodeId: 'episode-1',
      record: {
        id: 'history-1',
        cardId: 'final-video',
        title: 'Final Video',
        fileName: 'server.zip',
        createdAt: '2026-06-13T10:00:00.000Z',
        status: 'completed',
      },
    })).rejects.toMatchObject({
      code: 'CONFLICT',
      details: {
        code: 'EXPORT_HISTORY_ID_CONFLICT',
        field: 'id',
      },
    })

    expect(prismaMock.exportHistoryRecord.upsert).not.toHaveBeenCalled()
  })

  it('keeps ownership fields immutable when updating an existing in-scope history record', async () => {
    prismaMock.exportHistoryRecord.findUnique.mockResolvedValue({
      userId: 'user-1',
      projectId: 'project-1',
      scopeId: 'episode-1',
    })
    prismaMock.exportHistoryRecord.upsert.mockResolvedValue({})
    prismaMock.exportHistoryRecord.findMany.mockResolvedValue([])
    const { appendExportHistoryRecord } = await import('@/lib/novel-promotion/export-history-store')

    await appendExportHistoryRecord({
      userId: 'user-1',
      projectId: 'project-1',
      episodeId: 'episode-1',
      record: {
        id: 'history-1',
        cardId: 'final-video',
        title: 'Final Video',
        fileName: 'server.zip',
        createdAt: '2026-06-13T10:00:00.000Z',
        status: 'completed',
      },
    })

    expect(prismaMock.exportHistoryRecord.upsert).toHaveBeenCalled()
    const input = prismaMock.exportHistoryRecord.upsert.mock.calls[0]?.[0]
    expect(input.update).not.toHaveProperty('userId')
    expect(input.update).not.toHaveProperty('projectId')
    expect(input.update).not.toHaveProperty('scopeId')
    expect(input.update).not.toHaveProperty('episodeId')
  })

  it('surfaces database write failures instead of falling back to runtime files', async () => {
    prismaMock.exportHistoryRecord.findMany.mockResolvedValue([])
    prismaMock.exportHistoryRecord.createMany.mockResolvedValue({ count: 0 })
    prismaMock.exportHistoryRecord.findUnique.mockResolvedValue(null)
    prismaMock.exportHistoryRecord.upsert.mockRejectedValue(new Error('database offline'))
    const { appendExportHistoryRecord } = await import('@/lib/novel-promotion/export-history-store')

    await expect(appendExportHistoryRecord({
      userId: 'user-1',
      projectId: 'project-1',
      episodeId: 'episode-1',
      record: {
        id: 'history-1',
        cardId: 'final-video',
        title: 'Final Video',
        fileName: 'server.zip',
        createdAt: '2026-06-13T10:00:00.000Z',
        status: 'completed',
      },
    })).rejects.toThrow('database offline')
  })
})
