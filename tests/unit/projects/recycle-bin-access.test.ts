import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const authMock = vi.hoisted(() => ({
  requireUserAuth: vi.fn(),
  isErrorResponse: (value: unknown) => value instanceof NextResponse,
}))
const prismaMock = vi.hoisted(() => ({
  project: { findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  work: { findMany: vi.fn(), updateMany: vi.fn() },
  user: { findMany: vi.fn() },
  $transaction: vi.fn(),
}))
vi.mock('@/lib/api-auth', () => authMock)
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

const actor = {
  id: 'manager-1',
  actorId: 'leader-1',
  workspaceOwnerId: 'manager-1',
  role: 'writer',
  projectLeader: true,
}
const deletedAt = new Date('2026-11-06T00:00:00.000Z')

function recycledProject(createdById: string) {
  return {
    id: `project-${createdById}`,
    name: '已删除作品',
    createdById,
    deletedAt,
    deletedById: 'leader-1',
    deletedWithWork: false,
    workId: 'work-1',
    work: { id: 'work-1', name: '共享项目', createdById: 'leader-1', deletedAt: null, members: [{ role: 'leader', canManage: true }] },
    members: [],
  }
}

describe('work recycle-bin creator access', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMock.requireUserAuth.mockResolvedValue({ session: { user: actor } })
    prismaMock.project.findMany.mockResolvedValue([recycledProject('leader-1'), recycledProject('member-2')])
    prismaMock.work.findMany.mockResolvedValue([])
    prismaMock.user.findMany.mockResolvedValue([{ id: 'leader-1', name: '组长' }])
  })

  it('lists only works deleted by their creator, even for a project leader', async () => {
    const { GET } = await import('@/app/api/projects/recycle-bin/route')
    const response = await GET(new NextRequest('http://localhost/api/projects/recycle-bin'), { params: Promise.resolve({}) })
    const payload = await response.json()
    expect(response.status).toBe(200)
    expect(payload.projects.map((project: { createdById?: string; id: string }) => project.id)).toEqual(['project-leader-1'])
  })

  it('allows a manager to see every recycled work in the workspace', async () => {
    authMock.requireUserAuth.mockResolvedValueOnce({ session: { user: { ...actor, actorId: 'manager-1', role: 'admin', projectLeader: false } } })
    const { GET } = await import('@/app/api/projects/recycle-bin/route')
    const response = await GET(new NextRequest('http://localhost/api/projects/recycle-bin'), { params: Promise.resolve({}) })
    const payload = await response.json()
    expect(payload.projects).toHaveLength(2)
  })

  it('rejects restoring another member\'s work despite legacy leader membership', async () => {
    prismaMock.project.findFirst.mockResolvedValueOnce(recycledProject('member-2'))
    const { POST } = await import('@/app/api/projects/recycle-bin/[projectId]/restore/route')
    const response = await POST(new NextRequest('http://localhost/api/projects/recycle-bin/project-member-2/restore', { method: 'POST' }) as never, { params: Promise.resolve({ projectId: 'project-member-2' }) })
    expect(response.status).toBe(403)
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it('restores the creator\'s work and reports expired work as a conflict', async () => {
    prismaMock.$transaction.mockImplementation(async (callback: (tx: typeof prismaMock) => unknown) => callback(prismaMock))
    prismaMock.project.update.mockResolvedValue({ id: 'project-leader-1', name: '已删除作品', workId: 'work-1' })
    prismaMock.project.findFirst.mockResolvedValueOnce(recycledProject('leader-1'))
    const { POST } = await import('@/app/api/projects/recycle-bin/[projectId]/restore/route')
    const response = await POST(new NextRequest('http://localhost/api/projects/recycle-bin/project-leader-1/restore', { method: 'POST' }) as never, { params: Promise.resolve({ projectId: 'project-leader-1' }) })
    expect(response.status).toBe(200)
    expect(prismaMock.project.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'project-leader-1' },
      data: { deletedAt: null, deletedById: null, deletedWithWork: false },
    }))

    prismaMock.project.findFirst.mockResolvedValueOnce({ ...recycledProject('leader-1'), deletedAt: new Date(Date.now() - 16 * 24 * 60 * 60 * 1000) })
    const expired = await POST(new NextRequest('http://localhost/api/projects/recycle-bin/project-leader-1/restore', { method: 'POST' }) as never, { params: Promise.resolve({ projectId: 'project-leader-1' }) })
    expect(expired.status).toBe(409)
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1)
  })
})
