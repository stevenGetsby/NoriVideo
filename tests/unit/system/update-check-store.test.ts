import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  systemUpdateCheckRecord: {
    findMany: vi.fn(),
    createMany: vi.fn(),
    create: vi.fn(),
  },
}))

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))

describe('update check store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('surfaces database read failures instead of falling back to runtime files', async () => {
    prismaMock.systemUpdateCheckRecord.findMany.mockRejectedValue(new Error('database offline'))
    const { readUpdateCheckRecords } = await import('@/lib/system/update-check-store')

    await expect(readUpdateCheckRecords('user-1')).rejects.toThrow('database offline')
  })

  it('surfaces database write failures instead of falling back to runtime files', async () => {
    prismaMock.systemUpdateCheckRecord.createMany.mockResolvedValue({ count: 0 })
    prismaMock.systemUpdateCheckRecord.create.mockRejectedValue(new Error('database offline'))
    const { appendUpdateCheckRecord } = await import('@/lib/system/update-check-store')

    await expect(appendUpdateCheckRecord('user-1', {
      checkedAt: '2026-06-14T00:00:00.000Z',
      version: '0.4.1',
      bootId: 'boot-1',
      node: 'v24.0.0',
      npm: '11.0.0',
      next: '15.0.0',
      react: '19.0.0',
      app: 'nori',
      queues: [],
    })).rejects.toThrow('database offline')
  })
})
