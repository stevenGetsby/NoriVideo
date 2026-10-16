import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const authMock = vi.hoisted(() => ({
  requireUserAuth: vi.fn(),
  isErrorResponse: (value: unknown) => value instanceof Response,
}))
const prismaMock = vi.hoisted(() => ({
  project: { findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
  user: { findMany: vi.fn() },
}))

vi.mock('@/lib/api-auth', () => authMock)
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/projects/recycle-bin', () => ({
  projectRestoreDeadline: vi.fn((deletedAt: Date) => new Date(deletedAt.getTime() + 15 * 24 * 60 * 60 * 1000)),
}))

function authed(role: 'admin' | 'writer') {
  authMock.requireUserAuth.mockResolvedValue({
    session: {
      user: {
        id: 'workspace-1',
        actorId: 'actor-1',
        workspaceOwnerId: 'workspace-1',
        role,
      },
    },
  })
}

describe('作品回收站 API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.user.findMany.mockResolvedValue([])
  })

  it('子账号不能查看回收站', async () => {
    authed('writer')
    const { GET } = await import('@/app/api/projects/recycle-bin/route')

    const response = await GET(
      new NextRequest('http://localhost/api/projects/recycle-bin'),
      { params: Promise.resolve({}) },
    )

    expect(response.status).toBe(403)
    expect(prismaMock.project.findMany).not.toHaveBeenCalled()
  })

  it('管理账号只返回工作区内软删作品', async () => {
    authed('admin')
    prismaMock.project.findMany.mockResolvedValueOnce([{
      id: 'project-1',
      name: 'Project',
      deletedAt: new Date('2026-10-01T00:00:00.000Z'),
      deletedById: 'actor-1',
      work: { id: 'work-1', name: 'Work' },
    }])
    prismaMock.user.findMany.mockResolvedValueOnce([{ id: 'actor-1', name: 'Manager' }])
    const { GET } = await import('@/app/api/projects/recycle-bin/route')

    const response = await GET(
      new NextRequest('http://localhost/api/projects/recycle-bin'),
      { params: Promise.resolve({}) },
    )
    const payload = await response.json() as { projects?: Array<{ id?: string }> }

    expect(response.status).toBe(200)
    expect(prismaMock.project.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        userId: 'workspace-1',
        deletedAt: { not: null },
      },
    }))
    expect(payload.projects?.[0]?.id).toBe('project-1')
  })

  it('超过 15 天的软删作品不能恢复', async () => {
    authed('admin')
    prismaMock.project.findFirst.mockResolvedValueOnce({
      id: 'project-expired',
      name: 'Expired',
      deletedAt: new Date(Date.now() - 16 * 24 * 60 * 60 * 1000),
    })
    const { POST } = await import('@/app/api/projects/recycle-bin/[projectId]/restore/route')

    const response = await POST(
      new NextRequest('http://localhost/api/projects/recycle-bin/project-expired/restore', { method: 'POST' }),
      { params: Promise.resolve({ projectId: 'project-expired' }) },
    )

    expect(response.status).toBe(409)
    expect(prismaMock.project.update).not.toHaveBeenCalled()
  })

  it('管理账号可以恢复期限内作品', async () => {
    authed('admin')
    prismaMock.project.findFirst.mockResolvedValueOnce({
      id: 'project-1',
      name: 'Project',
      deletedAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    })
    prismaMock.project.update.mockResolvedValueOnce({
      id: 'project-1',
      name: 'Project',
      workId: 'work-1',
    })
    const { POST } = await import('@/app/api/projects/recycle-bin/[projectId]/restore/route')

    const response = await POST(
      new NextRequest('http://localhost/api/projects/recycle-bin/project-1/restore', { method: 'POST' }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )
    const payload = await response.json() as { project?: { id?: string } }

    expect(response.status).toBe(200)
    expect(prismaMock.project.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { deletedAt: null, deletedById: null },
    }))
    expect(payload.project?.id).toBe('project-1')
  })
})
