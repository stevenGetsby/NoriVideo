import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  canvas: { findMany: vi.fn() },
  frameosMaterial: { findMany: vi.fn() },
  frameosToolboxAsset: { findMany: vi.fn() },
  novelPromotionProject: { findUnique: vi.fn() },
  project: { findMany: vi.fn(), delete: vi.fn(), updateMany: vi.fn() },
  work: { findMany: vi.fn(), deleteMany: vi.fn() },
}))
const storageMock = vi.hoisted(() => ({ deleteObjects: vi.fn() }))
const bailianMock = vi.hoisted(() => ({
  collectProjectBailianManagedVoiceIds: vi.fn(),
  cleanupUnreferencedBailianVoices: vi.fn(),
}))
const unreferenced = vi.hoisted(() => vi.fn(async (_projectId: string, keys: string[]) => keys))
vi.mock('@/lib/projects/shared-media-retention', () => ({ unreferencedProjectStorageKeys: unreferenced }))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/media/service', () => ({
  resolveStorageKeyFromMediaValue: vi.fn(async () => null),
}))
vi.mock('@/lib/storage', () => ({
  deleteObjects: storageMock.deleteObjects,
  extractStorageKey: (value: string | null | undefined) => value ? value.replace(/^.*?uploads\//, 'uploads/') : null,
}))
vi.mock('@/lib/providers/bailian', () => bailianMock)
vi.mock('@/lib/logging/core', () => ({
  createScopedLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
  }),
}))

describe('回收站过期清理', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.canvas.findMany.mockResolvedValue([])
    prismaMock.frameosMaterial.findMany.mockResolvedValue([])
    prismaMock.frameosToolboxAsset.findMany.mockResolvedValue([])
    prismaMock.novelPromotionProject.findUnique.mockResolvedValue(null)
    prismaMock.project.findMany.mockResolvedValue([{
      id: 'project-1',
      name: 'Project',
      userId: 'user-1',
      workId: 'work-1',
      coverImageKey: null,
    }])
    prismaMock.project.updateMany.mockResolvedValue({ count: 0 })
    prismaMock.work.findMany.mockResolvedValue([])
    prismaMock.work.deleteMany.mockResolvedValue({ count: 0 })
    prismaMock.project.delete.mockResolvedValue({})
    storageMock.deleteObjects.mockResolvedValue({ success: 1, failed: 0 })
    bailianMock.collectProjectBailianManagedVoiceIds.mockResolvedValue([])
    bailianMock.cleanupUnreferencedBailianVoices.mockResolvedValue({
      attempted: 0,
      deleted: 0,
      deletedVoiceIds: [],
    })
  })

  it('先删除数据库，存储清理失败不影响清理结果', async () => {
    const calls: string[] = []
    prismaMock.frameosMaterial.findMany.mockResolvedValueOnce([{
      resultUrl: 'uploads/project.bin',
      storageKey: null,
    }])
    prismaMock.project.delete.mockImplementation(async () => {
      calls.push('database')
      return {}
    })
    storageMock.deleteObjects.mockImplementation(async () => {
      calls.push('storage')
      throw new Error('TOS unavailable')
    })
    const { purgeExpiredRecycleBinProjects } = await import('@/lib/projects/recycle-bin')

    const result = await purgeExpiredRecycleBinProjects()

    expect(result).toEqual({ purged: ['project-1'], failed: [] })
    expect(calls).toEqual(['database', 'storage'])
  })

  it('收集当前节点、历史版本和 3D 文档里的画布媒体 key', async () => {
    const { collectProjectStorageKeys } = await import('@/lib/projects/recycle-bin')

    await collectProjectStorageKeys('project-1')

    expect(storageMock.deleteObjects).not.toHaveBeenCalled()
    expect(prismaMock.canvas.findMany).toHaveBeenCalledWith({
      where: { projectId: 'project-1' },
      select: expect.objectContaining({
        nodes: expect.any(Object),
        snapshots: expect.any(Object),
      }),
    })
  })
  it('永久删除成功后清理自定义封面', async () => {
    prismaMock.project.findMany.mockResolvedValueOnce([{
      id: 'project-1',
      name: 'Project',
      userId: 'user-1',
      workId: 'work-1',
      coverImageKey: 'images/project-cover-project-1-abc123.jpg',
    }])
    const { purgeExpiredRecycleBinProjects } = await import('@/lib/projects/recycle-bin')

    expect(await purgeExpiredRecycleBinProjects()).toMatchObject({ purged: ['project-1'], failed: [] })
    expect(prismaMock.project.delete).toHaveBeenCalledWith({ where: { id: 'project-1' } })
    expect(unreferenced).toHaveBeenCalledWith('project-1', ['images/project-cover-project-1-abc123.jpg'])
    expect(storageMock.deleteObjects).toHaveBeenCalledWith(['images/project-cover-project-1-abc123.jpg'])
  })

  it('preserves a shared object used by another project after the original project expires', async () => {
    prismaMock.frameosMaterial.findMany.mockResolvedValueOnce([{ storageKey: 'uploads/shared.png', resultUrl: null }])
    unreferenced.mockResolvedValueOnce([])
    const { purgeExpiredRecycleBinProjects } = await import('@/lib/projects/recycle-bin')
    expect(await purgeExpiredRecycleBinProjects()).toMatchObject({ purged: ['project-1'], failed: [] })
    expect(unreferenced).toHaveBeenCalledWith('project-1', ['uploads/shared.png'])
    expect(storageMock.deleteObjects).not.toHaveBeenCalled()
  })
})
