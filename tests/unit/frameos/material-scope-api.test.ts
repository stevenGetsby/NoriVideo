import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'
import { buildMockRequest } from '../../helpers/request'

const session = {
  user: {
    id: 'workspace-1',
    actorId: 'member-1',
    workspaceOwnerId: 'workspace-1',
    name: '分镜师',
    role: 'storyboard' as const,
    permissions: ['storyboardWrite'] as const,
  },
}

const authMock = vi.hoisted(() => ({
  requireUserAuth: vi.fn(),
  requireProjectAuthLight: vi.fn(),
  requireUserPermission: vi.fn(),
  isErrorResponse: (value: unknown) => value instanceof Response,
}))

const prismaMock = vi.hoisted(() => ({
  project: { findMany: vi.fn() },
  user: { findMany: vi.fn() },
  frameosMaterial: { findMany: vi.fn(), count: vi.fn() },
}))

const readScope = vi.hoisted(() => ({
  where: { userId: 'workspace-1', OR: [{ members: { some: { userId: 'member-1' } } }] },
  projectReadScopeWhere: vi.fn(),
}))

vi.mock('@/lib/api-auth', () => authMock)
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/collaboration/access', () => ({
  getWorkspaceActor: () => ({
    workspaceOwnerId: 'workspace-1',
    actorId: 'member-1',
    isManagement: false,
  }),
  projectReadScopeWhere: readScope.projectReadScopeWhere,
  workspaceUserWhere: (workspaceOwnerId: string) => ({
    OR: [{ id: workspaceOwnerId }, { workspaceOwnerId }],
  }),
}))
vi.mock('@/lib/frameos/material-upload', () => ({
  uploadFrameosMaterial: vi.fn(),
}))
vi.mock('@/lib/frameos/material-service', () => ({
  syncGeneratedImagesToMaterialLibrary: vi.fn(),
}))

describe('FrameOS material project scopes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMock.requireUserAuth.mockResolvedValue({ session })
    authMock.requireProjectAuthLight.mockResolvedValue({ session, project: { id: 'project-b' } })
    authMock.requireUserPermission.mockResolvedValue({ session })
    readScope.projectReadScopeWhere.mockReturnValue(readScope.where)
    prismaMock.project.findMany.mockResolvedValue([
      { id: 'project-a', name: '甲作品' },
      { id: 'project-b', name: '乙作品' },
    ])
    prismaMock.user.findMany.mockResolvedValue([
      { id: 'workspace-1', name: '管理员' },
      { id: 'member-1', name: '分镜师' },
    ])
    prismaMock.frameosMaterial.findMany.mockResolvedValue([])
    prismaMock.frameosMaterial.count.mockResolvedValue(0)
  })

  it('returns only ACL-readable projects and scopes the aggregate material query to them', async () => {
    const { GET } = await import('@/app/api/frameos/materials/route')
    const response = await GET(buildMockRequest({
      path: '/api/frameos/materials?type=image',
      method: 'GET',
    }), { params: Promise.resolve({}) })

    expect(response.status).toBe(200)
    expect(readScope.projectReadScopeWhere).toHaveBeenCalledWith(session)
    expect(prismaMock.project.findMany).toHaveBeenCalledWith({
      where: readScope.where,
      select: { id: true, name: true },
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
    })
    expect(prismaMock.frameosMaterial.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        userId: { in: ['workspace-1', 'member-1'] },
        projectId: { in: ['project-a', 'project-b', 'global', 'global-asset-hub'] },
        deletedAt: null,
        type: 'image',
      }),
    }))
    await expect(response.json()).resolves.toMatchObject({
      projects: [
        { id: 'project-a', name: '甲作品' },
        { id: 'project-b', name: '乙作品' },
      ],
      capabilities: {
        trash: { supported: true, count: 0, reason: null },
      },
    })
  })

  it('authorizes a selected project and queries that project only', async () => {
    const { GET } = await import('@/app/api/frameos/materials/route')
    const response = await GET(buildMockRequest({
      path: '/api/frameos/materials?projectId=project-b&available=0',
      method: 'GET',
    }), { params: Promise.resolve({}) })

    expect(response.status).toBe(200)
    expect(authMock.requireProjectAuthLight).toHaveBeenCalledWith('project-b')
    expect(prismaMock.frameosMaterial.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ projectId: { in: ['project-b'] } }),
    }))
  })

  it('returns only soft-deleted materials for the trash scope and reports its real count', async () => {
    prismaMock.frameosMaterial.count.mockResolvedValueOnce(2)
    const { GET } = await import('@/app/api/frameos/materials/route')
    const response = await GET(buildMockRequest({
      path: '/api/frameos/materials?state=deleted',
      method: 'GET',
    }), { params: Promise.resolve({}) })

    expect(response.status).toBe(200)
    expect(prismaMock.frameosMaterial.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ deletedAt: { not: null } }),
    }))
    await expect(response.json()).resolves.toMatchObject({
      capabilities: { trash: { supported: true, count: 2, reason: null } },
    })
  })

  it('returns project authorization failures before reading projects or materials', async () => {
    authMock.requireProjectAuthLight.mockResolvedValueOnce(NextResponse.json({ error: 'forbidden' }, { status: 403 }))
    const { GET } = await import('@/app/api/frameos/materials/route')
    const response = await GET(buildMockRequest({
      path: '/api/frameos/materials?projectId=project-secret&available=0',
      method: 'GET',
    }), { params: Promise.resolve({}) })

    expect(response.status).toBe(403)
    expect(prismaMock.project.findMany).not.toHaveBeenCalled()
    expect(prismaMock.frameosMaterial.findMany).not.toHaveBeenCalled()
  })
})
