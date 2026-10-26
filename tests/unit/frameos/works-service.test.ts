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
    update: vi.fn(),
  },
  projectMember: {
    upsert: vi.fn(),
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
  projectReadScopeWhere: vi.fn(() => ({ userId: 'workspace-1', deletedAt: null })),
  visibleProjectsWhere: vi.fn(() => ({ OR: [{ createdById: 'actor-1' }] })),
  workReadScopeWhere: vi.fn(() => ({ workspaceOwnerId: 'workspace-1' })),
  workReadWhere: vi.fn(),
  workspaceUserWhere: vi.fn(() => ({
    OR: [{ id: 'workspace-1' }, { workspaceOwnerId: 'workspace-1' }],
  })),
}))

const assignmentsMock = vi.hoisted(() => ({
  syncProjectAssignmentsForProject: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/collaboration/access', () => accessMock)
vi.mock('@/lib/collaboration/assignments', () => assignmentsMock)

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
      work: { id: 'target-work', createdById: 'manager-1', projects: [] },
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

  it('keeps the visible total stable and filters nested 作品 by participation', async () => {
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
        name: '隐藏作品',
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
    expect(listQuery?.include?.projects?.where).toEqual({
      deletedAt: null,
      OR: [{ createdById: 'actor-1' }],
    })
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

  it('keeps a parent project undeletable while its works are in the recycle bin', async () => {
    prismaMock.work.findMany.mockResolvedValueOnce([{
      id: 'work-1',
      name: '回收站项目',
      createdAt: new Date('2026-07-17T00:00:00Z'),
      updatedAt: new Date('2026-07-18T00:00:00Z'),
      createdById: 'manager-1',
      createdBy: { id: 'manager-1', name: 'Manager', role: 'admin' },
      members: [],
      projects: [],
      _count: { projects: 1 },
    }])
    const originalSession = session
    const managementSession = {
      ...originalSession,
      user: { ...originalSession.user, role: 'admin' as const },
    }
    accessMock.getWorkspaceActor.mockReturnValueOnce({
      workspaceOwnerId: 'workspace-1',
      actorId: 'actor-1',
      isManagement: true,
    })
    const { listWorks } = await import('@/lib/works/service')

    const result = await listWorks(managementSession, { page: 1, pageSize: 20 })

    expect(result.works[0]).toMatchObject({ canDelete: false, projectCount: 0 })
    expect(result.projectHierarchy.projects[0]).toMatchObject({ kind: 'project', canDelete: false, workCount: 0 })
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
    })).resolves.toEqual({ moved: 2, targetProjectId: 'target-work', targetWorkId: 'target-work' })

    expect(accessMock.requireWorkManager).toHaveBeenCalledWith(session, 'target-work')
    expect(prismaMock.project.updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['project-1', 'project-2'] },
        userId: 'workspace-1',
        workId: 'source-work',
        deletedAt: null,
      },
      data: { workId: 'target-work' },
    })
  })

  it('rechecks that a work is empty in the atomic delete predicate', async () => {
    accessMock.requireWorkManager.mockResolvedValueOnce({
      actor: accessMock.getWorkspaceActor(),
      work: { id: 'work-1', createdById: 'actor-1', projects: [] },
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
      work: { id: 'work-1', createdById: 'actor-1', projects: [] },
      canManage: true,
    })
    prismaMock.work.deleteMany.mockResolvedValueOnce({ count: 0 })
    const { deleteWork } = await import('@/lib/works/service')

    await expect(deleteWork(session, 'work-1')).rejects.toMatchObject({
      code: 'CONFLICT',
      message: '项目仍有作品（含回收站）或内容已变化，请刷新后确认项目为空再删除。',
    })
  })

  it('does not delete a parent project while a child work remains in the recycle bin', async () => {
    accessMock.requireWorkManager.mockResolvedValueOnce({
      actor: accessMock.getWorkspaceActor(),
      work: { id: 'work-1', createdById: 'actor-1', projects: [] },
      canManage: true,
    })
    prismaMock.work.deleteMany.mockResolvedValueOnce({ count: 0 })
    const { deleteWork } = await import('@/lib/works/service')
    await expect(deleteWork(session, 'work-1')).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(prismaMock.work.deleteMany).toHaveBeenCalledWith({
      where: { id: 'work-1', projects: { none: {} } },
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
      message: '作品已被移动或删除，请刷新后重试。',
    })
  })

  it('requires both target-work management and source-project management', async () => {
    accessMock.requireWorkManager.mockRejectedValueOnce(
      new ApiError('FORBIDDEN', { message: '无权管理目标项目' }),
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
      work: { id: 'target-work', createdById: 'manager-1', projects: [] },
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

  it('rejects source alias conflicts before reading or changing database records', async () => {
    const { moveProjects } = await import('@/lib/works/service')
    await expect(moveProjects(session, {
      workIds: ['new-work'], projectIds: ['different-legacy-work'], targetProjectId: 'target-work',
    })).rejects.toMatchObject({ code: 'INVALID_PARAMS' })
    expect(accessMock.requireWorkManager).not.toHaveBeenCalled()
    expect(prismaMock.project.findMany).not.toHaveBeenCalled()
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it('does not move a work deleted between the source read and atomic update', async () => {
    const row = { id: 'project-1', workId: 'source-work', deletedAt: null as Date | null }
    prismaMock.project.findMany.mockResolvedValueOnce([{
      ...row, createdById: 'actor-1', work: { createdById: 'actor-1', members: [] }, members: [],
    }])
    prismaMock.$transaction.mockImplementationOnce(async (callback: (tx: typeof prismaMock) => unknown) => {
      row.deletedAt = new Date()
      return callback(prismaMock)
    })
    prismaMock.project.updateMany.mockImplementationOnce(async (input: {
      where: { deletedAt?: null }; data: { workId: string }
    }) => {
      if (input.where.deletedAt === null && row.deletedAt) return { count: 0 }
      row.workId = input.data.workId
      return { count: 1 }
    })
    const { moveProjects } = await import('@/lib/works/service')
    await expect(moveProjects(session, {
      workIds: [row.id], targetProjectId: 'target-work',
    })).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(row.workId).toBe('source-work')
    expect(row.deletedAt).not.toBeNull()
    expect(prismaMock.project.updateMany.mock.calls[0][0].where.deletedAt).toBeNull()
  })

  it('paginates member candidates and excludes the actor, creator, and existing memberships', async () => {
    accessMock.requireWorkManager.mockResolvedValueOnce({
      actor: accessMock.getWorkspaceActor(),
      work: { id: 'work-1', createdById: 'creator-1', projects: [{ id: 'project-1' }] },
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
      work: { id: 'work-1', createdById: 'creator-1', projects: [] },
      canManage: true,
    })
    const { removeWorkMember } = await import('@/lib/works/service')

    await expect(removeWorkMember(session, 'work-1', 'creator-1'))
      .rejects.toMatchObject({ code: 'CONFLICT' })
    expect(prismaMock.workMember.deleteMany).not.toHaveBeenCalled()
  })

  it('grants project review when a manager adds a reviewer as a collaborator', async () => {
    accessMock.requireProjectAssignmentManager.mockResolvedValueOnce({
      actor: accessMock.getWorkspaceActor(),
      project: { id: 'project-1', userId: 'workspace-1', collaborationMode: 'solo' },
    })
    accessMock.requireActiveWorkspaceUser.mockResolvedValueOnce({
      id: 'reviewer-1',
      role: 'reviewer',
    })
    prismaMock.projectMember.upsert.mockResolvedValueOnce({
      userId: 'reviewer-1',
      canReviewAssignments: true,
    })
    prismaMock.project.update.mockResolvedValueOnce({ id: 'project-1', collaborationMode: 'team' })
    const { addProjectMember } = await import('@/lib/works/service')

    await expect(addProjectMember(session, 'project-1', 'reviewer-1')).resolves.toMatchObject({
      userId: 'reviewer-1',
      canReviewAssignments: true,
    })
    expect(prismaMock.projectMember.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: {
        projectId: 'project-1',
        userId: 'reviewer-1',
        canManageAssignments: false,
        canReviewAssignments: true,
      },
      update: { canReviewAssignments: true },
    }))
    expect(prismaMock.project.update).toHaveBeenCalledWith({
      where: { id: 'project-1' },
      data: { collaborationMode: 'team' },
    })
    expect(assignmentsMock.syncProjectAssignmentsForProject).toHaveBeenCalledWith({
      projectId: 'project-1',
      workspaceOwnerId: 'workspace-1',
    })
  })

  it('does not grant review when adding a production subaccount', async () => {
    accessMock.requireProjectAssignmentManager.mockResolvedValueOnce({
      actor: accessMock.getWorkspaceActor(),
      project: { id: 'project-1', userId: 'workspace-1', collaborationMode: 'team' },
    })
    accessMock.requireActiveWorkspaceUser.mockResolvedValueOnce({
      id: 'writer-1',
      role: 'writer',
    })
    prismaMock.projectMember.upsert.mockResolvedValueOnce({
      userId: 'writer-1',
      canReviewAssignments: false,
    })
    const { addProjectMember } = await import('@/lib/works/service')

    await addProjectMember(session, 'project-1', 'writer-1')
    expect(prismaMock.projectMember.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: {
        projectId: 'project-1',
        userId: 'writer-1',
        canManageAssignments: false,
        canReviewAssignments: false,
      },
      update: {},
    }))
    expect(prismaMock.project.update).not.toHaveBeenCalled()
    expect(assignmentsMock.syncProjectAssignmentsForProject).not.toHaveBeenCalled()
  })
})
