import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  exportQueueRecord: {
    findMany: vi.fn(),
    upsert: vi.fn(),
  },
}))

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))

vi.mock('@/lib/storage', () => ({
  getSignedUrl: vi.fn((key: string) => `signed:${key}`),
}))

describe('export queue store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('surfaces database read failures instead of falling back to runtime files', async () => {
    prismaMock.exportQueueRecord.findMany.mockRejectedValue(new Error('database offline'))
    const { readExportQueue } = await import('@/lib/novel-promotion/export-queue-store')

    await expect(readExportQueue({
      userId: 'user-1',
      projectId: 'project-1',
      episodeId: 'episode-1',
    })).rejects.toThrow('database offline')
  })
})
