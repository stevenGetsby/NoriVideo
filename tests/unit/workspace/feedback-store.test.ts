import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  workspaceFeedbackRecord: {
    findMany: vi.fn(),
    createMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
}))

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))

describe('feedback store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('surfaces database read failures instead of falling back to runtime files', async () => {
    prismaMock.workspaceFeedbackRecord.findMany.mockRejectedValue(new Error('database offline'))
    const { readFeedbackRecords } = await import('@/lib/workspace/feedback-store')

    await expect(readFeedbackRecords('user-1')).rejects.toThrow('database offline')
  })

  it('surfaces database write failures instead of falling back to runtime files', async () => {
    prismaMock.workspaceFeedbackRecord.createMany.mockResolvedValue({ count: 0 })
    prismaMock.workspaceFeedbackRecord.findUnique.mockResolvedValue(null)
    prismaMock.workspaceFeedbackRecord.create.mockRejectedValue(new Error('database offline'))
    const { appendFeedbackRecord } = await import('@/lib/workspace/feedback-store')

    await expect(appendFeedbackRecord('user-1', {
      id: 'feedback-1',
      type: 'bug',
      title: 'Bug',
      description: 'Broken workflow',
      route: '/workspace',
      userAgent: 'test',
      createdAt: '2026-06-14T00:00:00.000Z',
      status: 'open',
    })).rejects.toThrow('database offline')
  })
})
