import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const authMock = vi.hoisted(() => ({
  requireUserAuth: vi.fn<() => Promise<{ session: { user: { id: string; name: string; role: string; actorId?: string; workspaceOwnerId?: string; projectLeader?: boolean } } }>>(async () => ({
    session: { user: { id: 'user-1', name: 'User 1', role: 'admin' } },
  })),
  isErrorResponse: (value: unknown) => value instanceof NextResponse,
}))

const prismaMock = vi.hoisted(() => ({
  project: {
    findFirst: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
}))
const storageMock = vi.hoisted(() => ({
  deleteObjects: vi.fn(),
}))

vi.mock('@/lib/api-auth', () => authMock)
vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))
vi.mock('@/lib/storage', () => ({
  addSignedUrlsToProject: vi.fn((project) => project),
  deleteObjects: storageMock.deleteObjects,
}))
vi.mock('@/lib/media/service', () => ({
  resolveStorageKeyFromMediaValue: vi.fn(async () => null),
}))
vi.mock('@/lib/logging/semantic', () => ({
  logProjectAction: vi.fn(),
}))
vi.mock('@/lib/providers/bailian', () => ({
  collectProjectBailianManagedVoiceIds: vi.fn(async () => []),
  cleanupUnreferencedBailianVoices: vi.fn(async () => ({ attempted: 0, deleted: 0 })),
}))

describe('/api/projects/[projectId] PATCH', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMock.requireUserAuth.mockResolvedValue({ session: { user: { id: 'user-1', name: 'User 1', role: 'admin' } } })
    prismaMock.project.findFirst.mockResolvedValue({
      id: 'project-1',
      userId: 'user-1',
      createdById: 'user-1',
      name: 'Project 1',
      description: 'old description',
      user: { id: 'user-1' },
      work: {
        createdById: 'user-1',
        members: [],
      },
      members: [],
    })
    prismaMock.project.update.mockResolvedValue({
      id: 'project-1',
      userId: 'user-1',
      name: 'Renamed project',
      description: 'new description',
    })
  })

  it('only persists allowed editable fields and ignores userId mass assignment', async () => {
    const { PATCH } = await import('@/app/api/projects/[projectId]/route')

    const response = await PATCH(
      new NextRequest('http://localhost/api/projects/project-1', {
        method: 'PATCH',
        body: JSON.stringify({
          name: 'Renamed project',
          description: 'new description',
          userId: 'user-2',
          createdAt: '2000-01-01T00:00:00.000Z',
        }),
        headers: { 'Content-Type': 'application/json' },
      }) as never,
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(prismaMock.project.findFirst).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: {
        id: 'project-1',
        userId: 'user-1',
        deletedAt: null,
      },
      include: expect.objectContaining({
        work: expect.any(Object),
        members: expect.any(Object),
      }),
    }))
    expect(prismaMock.project.findFirst).toHaveBeenNthCalledWith(2, {
      where: {
        id: 'project-1',
        userId: 'user-1',
        deletedAt: null,
      },
    })
    expect(prismaMock.project.update).toHaveBeenCalledWith({
      where: { id: 'project-1' },
      data: {
        name: 'Renamed project',
        description: 'new description',
      },
    })
    expect(payload.project.userId).toBe('user-1')
  })

  it('returns not found for projects outside the current user scope before updating', async () => {
    prismaMock.project.findFirst.mockResolvedValueOnce(null)
    const { PATCH } = await import('@/app/api/projects/[projectId]/route')

    const response = await PATCH(
      new NextRequest('http://localhost/api/projects/project-other', {
        method: 'PATCH',
        body: JSON.stringify({
          name: 'Renamed project',
        }),
        headers: { 'Content-Type': 'application/json' },
      }) as never,
      { params: Promise.resolve({ projectId: 'project-other' }) },
    )

    expect(response.status).toBe(404)
    expect(prismaMock.project.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: 'project-other',
        userId: 'user-1',
        deletedAt: null,
      },
      include: expect.objectContaining({
        work: expect.any(Object),
        members: expect.any(Object),
      }),
    }))
    expect(prismaMock.project.update).not.toHaveBeenCalled()
  })

  it.each(['writer', 'asset', 'storyboard', 'reviewer'])('allows an active workspace participant %s to perform secondary edits', async (role) => {
    authMock.requireUserAuth.mockResolvedValueOnce({ session: { user: { id: 'user-1', name: 'Creator', role } } })
    const { PATCH } = await import('@/app/api/projects/[projectId]/route')
    const response = await PATCH(new NextRequest('http://localhost/api/projects/project-1', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'forbidden' }),
    }) as never, { params: Promise.resolve({ projectId: 'project-1' }) })
    expect(response.status).toBe(200)
    expect(prismaMock.project.update).toHaveBeenCalledWith({ where: { id: 'project-1' }, data: { name: 'forbidden' } })
  })
})

describe('/api/projects/[projectId] DELETE', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMock.requireUserAuth.mockResolvedValue({ session: { user: { id: 'user-1', name: 'User 1', role: 'admin' } } })
    prismaMock.project.findFirst.mockResolvedValue({
      id: 'project-1',
      createdById: 'user-1',
      name: 'Project 1',
      work: {
        createdById: 'user-1',
        members: [],
      },
      members: [],
    })
    prismaMock.project.updateMany.mockResolvedValue({ count: 1 })
  })

  it('soft-deletes the project and keeps storage untouched for restore', async () => {
    const { DELETE } = await import('@/app/api/projects/[projectId]/route')

    const response = await DELETE(
      new NextRequest('http://localhost/api/projects/project-1', { method: 'DELETE' }) as never,
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )
    const payload = await response.json() as { deletedAt?: string; restoreDeadline?: string }

    expect(response.status).toBe(200)
    expect(prismaMock.project.updateMany).toHaveBeenCalledWith({
      where: { id: 'project-1', userId: 'user-1', deletedAt: null },
      data: expect.objectContaining({
        deletedAt: expect.any(Date),
        deletedById: 'user-1',
        deletedWithWork: false,
      }),
    })
    expect(storageMock.deleteObjects).not.toHaveBeenCalled()
    expect(payload.deletedAt).toBeTruthy()
    expect(new Date(payload.restoreDeadline!).getTime() - new Date(payload.deletedAt!).getTime())
      .toBe(15 * 24 * 60 * 60 * 1000)
  })
  it('lets a project leader delete only their own work, not another member\'s work', async () => {
    authMock.requireUserAuth.mockResolvedValue({ session: { user: { id: 'user-1', actorId: 'child-1', workspaceOwnerId: 'user-1', name: 'Child', role: 'writer', projectLeader: true } } })
    prismaMock.project.findFirst.mockResolvedValueOnce({
      id: 'project-1',
      createdById: 'child-1',
      name: 'Own work',
      userId: 'user-1',
      work: { createdById: 'user-1', members: [{ role: 'leader', canManage: true, permissions: null }] },
      members: [{ role: 'member', permissions: null, canManageAssignments: true, canReviewAssignments: false }],
    })
    prismaMock.project.findFirst.mockResolvedValueOnce({ id: 'project-1', name: 'Own work', createdById: 'child-1' })
    const { DELETE } = await import('@/app/api/projects/[projectId]/route')
    const response = await DELETE(new NextRequest('http://localhost/api/projects/project-1', { method: 'DELETE' }) as never,
      { params: Promise.resolve({ projectId: 'project-1' }) })
    expect(response.status).toBe(200)
    expect(prismaMock.project.updateMany).toHaveBeenCalledWith({
      where: { id: 'project-1', userId: 'user-1', deletedAt: null, createdById: 'child-1' },
      data: expect.objectContaining({ deletedAt: expect.any(Date), deletedById: 'child-1' }),
    })

    prismaMock.project.findFirst.mockResolvedValueOnce({
      id: 'project-2', createdById: 'another-member', userId: 'user-1',
      work: { createdById: 'user-1', members: [{ role: 'leader', canManage: true, permissions: null }] },
      members: [],
    })
    const forbidden = await DELETE(new NextRequest('http://localhost/api/projects/project-2', { method: 'DELETE' }) as never,
      { params: Promise.resolve({ projectId: 'project-2' }) })
    expect(forbidden.status).toBe(403)
    expect(prismaMock.project.updateMany).toHaveBeenCalledTimes(1)
  })

  it('rejects deletion by an ordinary project member who did not create the work', async () => {
    authMock.requireUserAuth.mockResolvedValueOnce({ session: { user: { id: 'user-1', actorId: 'member-1', workspaceOwnerId: 'user-1', name: 'Member', role: 'writer', projectLeader: false } } })
    prismaMock.project.findFirst.mockResolvedValueOnce({
      id: 'project-1', createdById: 'another-member',
      work: { createdById: 'user-1', members: [{ role: 'member', canManage: false }] },
      members: [],
    })
    const { DELETE } = await import('@/app/api/projects/[projectId]/route')
    const response = await DELETE(new NextRequest('http://localhost/api/projects/project-1', { method: 'DELETE' }) as never,
      { params: Promise.resolve({ projectId: 'project-1' }) })
    expect(response.status).toBe(403)
    expect(prismaMock.project.updateMany).not.toHaveBeenCalled()
  })

  it('returns a conflict when a concurrent request already recycled the work', async () => {
    prismaMock.project.updateMany.mockResolvedValueOnce({ count: 0 })
    const { DELETE } = await import('@/app/api/projects/[projectId]/route')
    const response = await DELETE(new NextRequest('http://localhost/api/projects/project-1', { method: 'DELETE' }) as never,
      { params: Promise.resolve({ projectId: 'project-1' }) })
    expect(response.status).toBe(409)
  })
})

describe('/api/projects/[projectId] GET privacy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMock.requireUserAuth.mockResolvedValue({ session: { user: { id: 'user-1', name: 'User 1', role: 'admin' } } })
    prismaMock.project.findFirst.mockResolvedValue({
      id: 'project-1',
      userId: 'user-1',
      name: 'Project 1',
      description: null,
      createdAt: new Date('2026-07-17T00:00:00.000Z'),
      updatedAt: new Date('2026-07-17T00:00:00.000Z'),
      createdById: 'user-1',
      lastAccessedAt: null,
    })
    prismaMock.project.updateMany.mockResolvedValue({ count: 1 })
  })

  it('does not join or expose the owning User record', async () => {
    const { GET } = await import('@/app/api/projects/[projectId]/route')
    const response = await GET(
      new NextRequest('http://localhost/api/projects/project-1'),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )
    const payload = await response.json() as { project: Record<string, unknown> }

    expect(response.status).toBe(200)
    expect(prismaMock.project.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'project-1',
        userId: 'user-1',
        deletedAt: null,
      },
    })
    expect(payload.project).not.toHaveProperty('user')
    expect(payload.project).not.toHaveProperty('password')
    expect(payload.project.canDelete).toBe(true)
  })

  it('lets a child delete their own work but never another member\'s work', async () => {
    authMock.requireUserAuth.mockResolvedValue({ session: { user: { id: 'user-1', actorId: 'member-1', workspaceOwnerId: 'user-1', name: 'Member', role: 'writer' } } })
    prismaMock.project.findFirst.mockResolvedValueOnce({
      id: 'project-1', userId: 'user-1', name: 'Own work', createdById: 'member-1',
    })
    const { GET } = await import('@/app/api/projects/[projectId]/route')
    const request = new NextRequest('http://localhost/api/projects/project-1')
    const context = { params: Promise.resolve({ projectId: 'project-1' }) }
    const own = await GET(request, context)
    expect((await own.json()).project.canDelete).toBe(true)
    expect(prismaMock.project.findFirst).toHaveBeenCalledWith({ where: {
      id: 'project-1', userId: 'user-1', deletedAt: null,
      work: {
        OR: [
          { createdById: 'member-1' },
          { members: { some: { userId: 'member-1' } } },
        ],
      },
    } })

    prismaMock.project.findFirst.mockResolvedValueOnce({
      id: 'project-1', userId: 'user-1', name: 'Another member work', createdById: 'member-2',
    })
    const other = await GET(request, context)
    expect(other.status).toBe(200)
    expect((await other.json()).project.canDelete).toBe(false)
  })

  it('keeps administrative deletion without granting it to other child accounts', async () => {
    prismaMock.project.findFirst.mockResolvedValueOnce({
      id: 'project-1', userId: 'user-1', name: 'Member work', createdById: 'member-2',
    })
    const { GET } = await import('@/app/api/projects/[projectId]/route')
    const response = await GET(new NextRequest('http://localhost/api/projects/project-1'), { params: Promise.resolve({ projectId: 'project-1' }) })
    expect((await response.json()).project.canDelete).toBe(true)
  })
})
