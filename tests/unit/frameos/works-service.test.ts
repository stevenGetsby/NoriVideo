import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api-errors'

const prismaMock = vi.hoisted(() => ({
  work: {
    count: vi.fn(),
    deleteMany: vi.fn(),
    findMany: vi.fn(),
  },
  project: {
    findMany: vi.fn(),
    updateMany: vi.fn(),
  },
  user: {
    count: vi.fn(),
    findMany: vi.fn(),
  },
  workMember: {
    deleteMany: vi.fn(),
  },
  $transaction: vi.fn(),
}))

const accessMock = vi.hoisted(() => ({
  getWorkspaceActor: vi.fn(() => ({
    workspaceOwnerId: 'workspace-1',
    actorId: 'actor-1',
    isManagement: false,
  })),
  requireActiveWorkspaceUser: vi.fn(),
  requireProjectAssignmentManager: vi.fn(),
  requireProjectReader: vi.fn(),
  requireWorkManager: vi.fn(),
  workReadScopeWhere: vi.fn(() => ({ workspaceOwnerId: 'workspace-1' })),
  workReadWhere: vi.fn(),
  workspaceUserWhere: vi.fn(() => ({
    OR: [{ id: 'workspace-1' }, { workspaceOwnerId: 'workspace-1' }],
  })),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/collaboration/access', () => accessMock)

const session = {
  user: {
    id: 'workspace-1',
    actorId: 'actor-1',
    workspaceOwnerId: 'workspace-1',
    role: 'writer' as const,
  },
}

describe('works service behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    accessMock.getWorkspaceActor.mockReturnValue({
      workspaceOwnerId: 'workspace-1',
      actorId: 'actor-1',
      isManagement: false,
    })
    accessMock.requireWorkManager.mockResolvedValue({
      actor: accessMock.getWorkspaceActor(),
      work: { id: 'target-work', createdById: 'manager-1', _count: { projects: 0 } },
      canManage: true,
    })
    prismaMock.work.count.mockResolvedValue(0)
    prismaMock.work.deleteMany.mockResolvedValue({ count: 1 })
    prismaMock.work.findMany.mockResolvedValue([])
    prismaMock.project.findMany.mockResolvedValue([])
    prismaMock.project.updateMany.mockResolvedValue({ count: 0 })
    prismaMock.user.count.mockResolvedValue(0)
    prismaMock.user.findMany.mockResolvedValue([])
    prismaMock.workMember.deleteMany.mockResolvedValue({ count: 0 })
    prismaMock.$transaction.mockImplementation(async (callback: (tx: typeof prismaMock) => unknown) => callback(prismaMock))
  })

  it('keeps the workspace total stable and returns every project to a direct subaccount', async () => {
    prismaMock.work.count
      .mockResolvedValueOnce(7)
      .mockResolvedValueOnce(1)
    prismaMock.work.findMany.mockResolvedValueOnce([{
      id: 'work-1',
      name: '海外短剧',
      createdAt: new Date('2026-07-17T00:00:00Z'),
      updatedAt: new Date('2026-07-18T00:00:00Z'),
      createdById: 'creator-1',
      createdBy: { id: 'creator-1', name: 'Creator', role: 'admin' },
      members: [],
      projects: [{
        id: 'project-readable',
        name: '伦敦篇',
        description: '海外风格',
        createdAt: new Date('2026-07-17T00:00:00Z'),
        updatedAt: new Date('2026-07-18T00:00:00Z'),
        workId: 'work-1',
        createdById: 'creator-1',
        collaborationMode: 'team',
        members: [{
          userId: 'actor-1',
          canManageAssignments: false,
          canReviewAssignments: false,
        }],
        novelPromotionData: null,
      }, {
        id: 'project-hidden',
        name: '隐藏项目',
        description: '海外风格',
        createdAt: new Date('2026-07-17T00:00:00Z'),
        updatedAt: new Date('2026-07-18T00:00:00Z'),
        workId: 'work-1',
        createdById: 'creator-2',
        collaborationMode: 'team',
        members: [],
        novelPromotionData: null,
      }],
      _count: { projects: 2 },
    }])
    const { listWorks } = await import('@/lib/works/service')

    const result = await listWorks(session, {
      page: 1,
      pageSize: 2,
      search: '  海外风格  ',
    })

    expect(prismaMock.work.count).toHaveBeenNthCalledWith(1, {
      where: { workspaceOwnerId: 'workspace-1' },
    })
    expect(prismaMock.work.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        AND: [
          { workspaceOwnerId: 'workspace-1' },
          expect.objectContaining({ OR: expect.any(Array) }),
        ],
      },
      skip: 0,
      take: 2,
    }))
    const listQuery = prismaMock.work.findMany.mock.calls[0]?.[0]
    expect(listQuery?.include?.projects?.select?.novelPromotionData?.select?._count).toEqual({
      select: { episodes: true },
    })
    expect(result.pagination).toEqual({
      page: 1,
      pageSize: 2,
      total: 7,
      matchedTotal: 1,
      totalPages: 1,
    })
    expect(result.works[0]).toMatchObject({
      id: 'work-1',
      projectCount: 2,
      canManage: false,
    })
    expect(result.works[0]?.projects.map((project) => project.id)).toEqual([
      'project-readable',
      'project-hidden',
    ])
  })

  it('claims every project against its observed source work during a move', async () => {
    prismaMock.project.findMany.mockResolvedValueOnce([
      {
        id: 'project-1',
        workId: 'source-work',
        createdById: 'actor-1',
        work: { createdById: 'creator-1', members: [] },
        members: [],
      },
      {
        id: 'project-2',
        workId: 'source-work',
        createdById: 'actor-1',
        work: { createdById: 'creator-1', members: [] },
        members: [],
      },
    ])
    prismaMock.project.updateMany.mockResolvedValueOnce({ count: 2 })
    const { moveProjects } = await import('@/lib/works/service')

    await expect(moveProjects(session, {
      projectIds: ['project-1', 'project-2'],
      targetWorkId: 'target-work',
    })).resolves.toEqual({ moved: 2, targetWorkId: 'target-work' })

    expect(accessMock.requireWorkManager).toHaveBeenCalledWith(session, 'target-work')
    expect(prismaMock.project.updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['project-1', 'project-2'] },
        userId: 'workspace-1',
        workId: 'source-work',
      },
      data: { workId: 'target-work' },
    })
  })

  it('rechecks that a work is empty in the atomic delete predicate', async () => {
    accessMock.requireWorkManager.mockResolvedValueOnce({
      actor: accessMock.getWorkspaceActor(),
      work: { id: 'work-1', createdById: 'actor-1', _count: { projects: 0 } },
      canManage: true,
    })
    const { deleteWork } = await import('@/lib/works/service')

    await expect(deleteWork(session, 'work-1')).resolves.toBeUndefined()
    expect(prismaMock.work.deleteMany).toHaveBeenCalledWith({
      where: {
        id: 'work-1',
        projects: { none: {} },
      },
    })
  })

  it('reports a conflict when a work gains a project during deletion', async () => {
    accessMock.requireWorkManager.mockResolvedValueOnce({
      actor: accessMock.getWorkspaceActor(),
      work: { id: 'work-1', createdById: 'actor-1', _count: { projects: 0 } },
      canManage: true,
    })
    prismaMock.work.deleteMany.mockResolvedValueOnce({ count: 0 })
    const { deleteWork } = await import('@/lib/works/service')

    await expect(deleteWork(session, 'work-1')).rejects.toMatchObject({
      code: 'CONFLICT',
      message: '作品内容已变化，请刷新后确认作品为空再删除。',
    })
  })

  it('rejects a stale concurrent move instead of overwriting its destination', async () => {
    prismaMock.project.findMany.mockResolvedValueOnce([{
      id: 'project-1',
      workId: 'source-work',
      createdById: 'actor-1',
      work: { createdById: 'creator-1', members: [] },
      members: [],
    }])
    prismaMock.project.updateMany.mockResolvedValueOnce({ count: 0 })
    const { moveProjects } = await import('@/lib/works/service')

    await expect(moveProjects(session, {
      projectIds: ['project-1'],
      targetWorkId: 'target-work',
    })).rejects.toMatchObject({
      code: 'CONFLICT',
      message: '项目已被移动，请刷新后重试。',
    })
  })

  it('requires both target-work management and source-project management', async () => {
    accessMock.requireWorkManager.mockRejectedValueOnce(
      new ApiError('FORBIDDEN', { message: '无权管理目标作品' }),
    )
    const { moveProjects } = await import('@/lib/works/service')

    await expect(moveProjects(session, {
      projectIds: ['project-1'],
      targetWorkId: 'target-work',
    })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(prismaMock.project.findMany).not.toHaveBeenCalled()

    vi.clearAllMocks()
    accessMock.getWorkspaceActor.mockReturnValue({
      workspaceOwnerId: 'workspace-1',
      actorId: 'actor-1',
      isManagement: false,
    })
    accessMock.requireWorkManager.mockResolvedValue({
      actor: accessMock.getWorkspaceActor(),
      work: { id: 'target-work', createdById: 'manager-1', _count: { projects: 0 } },
      canManage: true,
    })
    prismaMock.project.findMany.mockResolvedValueOnce([{
      id: 'project-1',
      workId: 'source-work',
      createdById: 'creator-2',
      work: { createdById: 'creator-1', members: [] },
      members: [],
    }])

    await expect(moveProjects(session, {
      projectIds: ['project-1'],
      targetWorkId: 'target-work',
    })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it('paginates member candidates and excludes the actor, creator, and existing memberships', async () => {
    accessMock.requireWorkManager.mockResolvedValueOnce({
      actor: accessMock.getWorkspaceActor(),
      work: { id: 'work-1', createdById: 'creator-1', _count: { projects: 1 } },
      canManage: true,
    })
    prismaMock.user.count.mockResolvedValueOnce(21)
    prismaMock.user.findMany.mockResolvedValueOnce([{
      id: 'candidate-11',
      name: '候选成员',
      role: 'asset',
      roleLabel: '视觉资产师',
      permissions: ['read', 'assetWrite', 'canvasWrite'],
      status: 'active',
    }])
    const { listMemberCandidates } = await import('@/lib/works/service')

    const result = await listMemberCandidates(session, {
      workId: 'work-1',
      keyword: '  候选  ',
      page: 2,
      pageSize: 10,
    })

    const expectedWhere = {
      status: 'active',
      OR: [{ id: 'workspace-1' }, { workspaceOwnerId: 'workspace-1' }],
      name: { contains: '候选' },
      id: { notIn: ['actor-1', 'creator-1'] },
      workMemberships: { none: { workId: 'work-1' } },
    }
    expect(prismaMock.user.count).toHaveBeenCalledWith({ where: expectedWhere })
    expect(prismaMock.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expectedWhere,
      skip: 10,
      take: 10,
    }))
    expect(result).toEqual({
      candidates: [{
        userId: 'candidate-11',
        name: '候选成员',
        role: 'asset',
        roleLabel: '视觉资产师',
        permissions: ['read', 'assetWrite', 'canvasWrite'],
        status: 'active',
      }],
      pagination: { page: 2, pageSize: 10, total: 21, totalPages: 3 },
    })
  })

  it('never removes the work creator from membership', async () => {
    accessMock.requireWorkManager.mockResolvedValueOnce({
      actor: accessMock.getWorkspaceActor(),
      work: { id: 'work-1', createdById: 'creator-1', _count: { projects: 0 } },
      canManage: true,
    })
    const { removeWorkMember } = await import('@/lib/works/service')

    await expect(removeWorkMember(session, 'work-1', 'creator-1'))
      .rejects.toMatchObject({ code: 'CONFLICT' })
    expect(prismaMock.workMember.deleteMany).not.toHaveBeenCalled()
  })
})
