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
      { id: 'project-a', name: '甲作品', workId: 'work-1' },
      { id: 'project-b', name: '乙作品', workId: 'work-2' },
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
      select: { id: true, name: true, workId: true },
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

  it('shares all authorized works within one business project without mixing other projects', async () => {
    prismaMock.project.findMany.mockResolvedValueOnce([
      { id: 'project-a', name: '作品一', workId: 'work-1' },
      { id: 'project-shared', name: '作品二', workId: 'work-1' },
    ]).mockResolvedValueOnce([])
    const { GET } = await import('@/app/api/frameos/materials/route')
    const response = await GET(buildMockRequest({
      path: '/api/frameos/materials?workId=work-1&projectId=project-a',
      method: 'GET',
    }), { params: Promise.resolve({}) })

    expect(response.status).toBe(200)
    expect(prismaMock.frameosMaterial.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ projectId: { in: ['project-a', 'project-shared'] } }),
    }))
    expect(prismaMock.project.findMany.mock.calls[0][0].where).toEqual({
      AND: [readScope.where, { workId: 'work-1' }],
    })
  })

  it('resolves a sibling-work voice only inside the same authorized asset scope', async () => {
    const character = { id: 'character-1', projectId: 'project-a', userId: 'workspace-1', title: '角色', type: 'image', source: 'upload', status: 'ready', resultUrl: 'images/character.png', metadata: { voiceMaterialId: 'voice-1' } }
    prismaMock.project.findMany.mockResolvedValueOnce([{ id: 'project-a', name: '甲作品', workId: 'work-1' }, { id: 'project-shared', name: '同项目作品', workId: 'work-1' }]).mockResolvedValueOnce([])
    prismaMock.frameosMaterial.findMany.mockResolvedValueOnce([character]).mockResolvedValueOnce([{ id: 'voice-1', projectId: 'project-shared', userId: 'member-1', title: '同项目音色', type: 'audio', status: 'ready', resultUrl: 'voice/character.mp3' }])
    const { GET } = await import('@/app/api/frameos/materials/route')
    const response = await GET(buildMockRequest({ path: '/api/frameos/materials?workId=work-1&projectId=project-a', method: 'GET' }), { params: Promise.resolve({}) })
    expect(response.status).toBe(200)
    expect(prismaMock.frameosMaterial.findMany.mock.calls[1][0].where).toMatchObject({ id: { in: ['voice-1'] }, projectId: { in: ['project-a', 'project-shared'] }, type: 'audio', deletedAt: null })
    expect((await response.json()).materials[0].voice).toMatchObject({ materialId: 'voice-1', title: '同项目音色' })
  })

  it('never resolves a voice outside the explicitly selected work', async () => {
    const character = { id: 'character-1', projectId: 'project-a', userId: 'workspace-1', title: '角色', type: 'image', source: 'upload', status: 'ready', resultUrl: 'images/character.png', metadata: { voiceMaterialId: 'voice-foreign' } }
    prismaMock.frameosMaterial.findMany.mockResolvedValueOnce([character]).mockResolvedValueOnce([])
    const { GET } = await import('@/app/api/frameos/materials/route')
    const response = await GET(buildMockRequest({ path: '/api/frameos/materials?projectId=project-a&available=0', method: 'GET' }), { params: Promise.resolve({}) })
    expect(response.status).toBe(200)
    expect(prismaMock.frameosMaterial.findMany.mock.calls[1][0].where).toMatchObject({ id: { in: ['voice-foreign'] }, projectId: { in: ['project-a'] }, type: 'audio', deletedAt: null })
    expect((await response.json()).materials[0].voice).toBeNull()
  })

  it('rejects a cross-project workId/projectId pair before reading materials', async () => {
    prismaMock.project.findMany.mockResolvedValueOnce([])
    const { GET } = await import('@/app/api/frameos/materials/route')
    const response = await GET(buildMockRequest({
      path: '/api/frameos/materials?workId=work-other&projectId=project-b',
      method: 'GET',
    }), { params: Promise.resolve({}) })
    expect(response.status).toBe(404)
    expect(prismaMock.frameosMaterial.findMany).not.toHaveBeenCalled()
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

  it('uses personalOwnerId rather than a display name for personal reads and never calls project auth with personal', async () => {
    const { GET } = await import('@/app/api/frameos/materials/route')
    const response = await GET(buildMockRequest({ path: '/api/frameos/materials?projectId=personal&scope=personal', method: 'GET' }), { params: Promise.resolve({}) })
    expect(response.status).toBe(200)
    expect(authMock.requireProjectAuthLight).not.toHaveBeenCalled()
    expect(prismaMock.frameosMaterial.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ projectId: 'personal', personalOwnerId: 'member-1' }) }))
  })

  it('combines only own personal materials and shared project materials in the accessible scope', async () => {
    const { GET } = await import('@/app/api/frameos/materials/route')
    const response = await GET(buildMockRequest({ path: '/api/frameos/materials?scope=all', method: 'GET' }), { params: Promise.resolve({}) })
    expect(response.status).toBe(200)
    expect(prismaMock.frameosMaterial.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ OR: [{ personalOwnerId: null }, { personalOwnerId: 'member-1', projectId: 'personal' }] }) }))
  })

  it('excludes personal records from the shared-project scope', async () => {
    const { GET } = await import('@/app/api/frameos/materials/route')
    const response = await GET(buildMockRequest({ path: '/api/frameos/materials?scope=project', method: 'GET' }), { params: Promise.resolve({}) })
    expect(response.status).toBe(200)
    expect(prismaMock.frameosMaterial.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ personalOwnerId: null }) }))
  })
})
