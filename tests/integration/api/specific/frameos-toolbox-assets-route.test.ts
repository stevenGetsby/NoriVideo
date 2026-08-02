import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../../helpers/request'

const requireUserAuthMock = vi.hoisted(() => vi.fn())
const prismaMock = vi.hoisted(() => ({
  project: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
  },
  frameosToolboxAsset: {
    findMany: vi.fn(),
  },
  task: {
    findMany: vi.fn(),
  },
  frameosMaterial: {
    findMany: vi.fn(),
  },
}))

vi.mock('@/lib/api-auth', () => ({
  requireUserAuth: requireUserAuthMock,
  isErrorResponse: (value: unknown) => value instanceof Response,
}))
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

import { GET } from '@/app/api/frameos/toolbox/assets/route'

const childSession = {
  user: {
    id: 'owner-1',
    actorId: 'storyboard-child',
    workspaceOwnerId: 'owner-1',
    role: 'storyboard',
    permissions: ['assetRead', 'storyboardWrite'],
  },
}

function request(query: Record<string, string> = {}) {
  return buildMockRequest({
    path: '/api/frameos/toolbox/assets',
    method: 'GET',
    query,
  })
}

describe('FrameOS toolbox asset list access', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireUserAuthMock.mockResolvedValue({ session: childSession })
    prismaMock.project.findFirst.mockResolvedValue({ id: 'project-assigned' })
    prismaMock.project.findMany.mockResolvedValue([{ id: 'project-assigned' }])
    prismaMock.frameosToolboxAsset.findMany.mockResolvedValue([])
    prismaMock.task.findMany.mockResolvedValue([])
    prismaMock.frameosMaterial.findMany.mockResolvedValue([])
  })

  it('does not let a child account probe a project outside its management workspace', async () => {
    prismaMock.project.findFirst.mockResolvedValueOnce(null)
    prismaMock.frameosToolboxAsset.findMany.mockResolvedValue([{
      id: 'secret-asset',
      userId: 'owner-1',
      projectId: 'project-secret',
      params: { prompt: '其他团队秘密提示词' },
      resultUrl: 'https://private.test/secret.png',
    }])

    const response = await GET(request({ projectId: 'project-secret' }), { params: Promise.resolve({}) })
    const payload = await response.json()

    expect(response.status).toBe(404)
    expect(prismaMock.project.findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'project-secret',
        userId: 'owner-1',
      }),
      select: { id: true },
    })
    expect(prismaMock.frameosToolboxAsset.findMany).not.toHaveBeenCalled()
    expect(JSON.stringify(payload)).not.toContain('其他团队秘密提示词')
    expect(JSON.stringify(payload)).not.toContain('https://private.test/secret.png')
  })

  it('lets a child account read unscoped history from every project in its management workspace', async () => {
    const allWorkspaceAssets = [
      {
        id: 'account-asset',
        userId: 'owner-1',
        projectId: null,
        type: 'image',
        params: { prompt: '账号共享提示词' },
        resultUrl: 'https://assets.test/account.png',
        materialId: null,
      },
      {
        id: 'assigned-asset',
        userId: 'owner-1',
        projectId: 'project-assigned',
        type: 'image',
        params: { prompt: '已分配项目提示词' },
        resultUrl: 'https://assets.test/assigned.png',
        materialId: null,
      },
      {
        id: 'secret-asset',
        userId: 'owner-1',
        projectId: 'project-secret',
        type: 'image',
        params: { prompt: '团队其他项目提示词' },
        resultUrl: 'https://assets.test/team-project.png',
        materialId: null,
      },
    ]
    prismaMock.project.findMany.mockResolvedValueOnce([
      { id: 'project-assigned' },
      { id: 'project-secret' },
    ])
    prismaMock.frameosToolboxAsset.findMany.mockImplementationOnce(async (args: {
      where?: { OR?: Array<{ projectId?: null | { in?: string[] } }> }
    }) => {
      const clauses = args.where?.OR
      if (!clauses) return allWorkspaceAssets
      const allowsAccountAssets = clauses.some((clause) => clause.projectId === null)
      const allowedProjectIds = clauses.flatMap((clause) => (
        clause.projectId && typeof clause.projectId === 'object' ? clause.projectId.in || [] : []
      ))
      return allWorkspaceAssets.filter((asset) => (
        (asset.projectId === null && allowsAccountAssets)
        || (typeof asset.projectId === 'string' && allowedProjectIds.includes(asset.projectId))
      ))
    })

    const response = await GET(request({ type: 'image', limit: '25' }), { params: Promise.resolve({}) })
    const payload = await response.json() as { assets: Array<{ id: string }> }

    expect(prismaMock.project.findMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        userId: 'owner-1',
      }),
      select: { id: true },
    })
    expect(prismaMock.frameosToolboxAsset.findMany).toHaveBeenCalledWith({
      where: {
        userId: 'owner-1',
        OR: [
          { projectId: null },
          { projectId: { in: ['project-assigned', 'project-secret'] } },
        ],
        type: 'image',
      },
      orderBy: { createdAt: 'desc' },
      take: 25,
    })
    expect(payload.assets.map((asset) => asset.id)).toEqual(['account-asset', 'assigned-asset', 'secret-asset'])
    expect(JSON.stringify(payload)).toContain('团队其他项目提示词')
    expect(JSON.stringify(payload)).toContain('https://assets.test/team-project.png')
  })

  it('keeps unscoped management history workspace-wide', async () => {
    requireUserAuthMock.mockResolvedValueOnce({
      session: {
        user: {
          id: 'owner-1',
          actorId: 'owner-1',
          workspaceOwnerId: 'owner-1',
          role: 'admin',
        },
      },
    })

    const response = await GET(request(), { params: Promise.resolve({}) })

    expect(response.status).toBe(200)
    expect(prismaMock.project.findFirst).not.toHaveBeenCalled()
    expect(prismaMock.project.findMany).not.toHaveBeenCalled()
    expect(prismaMock.frameosToolboxAsset.findMany).toHaveBeenCalledWith({
      where: { userId: 'owner-1' },
      orderBy: { createdAt: 'desc' },
      take: 80,
    })
  })

  it('can isolate the visible history to assets actually created by the toolbox', async () => {
    const response = await GET(request({
      projectId: 'project-assigned',
      type: 'video',
      source: 'toolbox',
    }), { params: Promise.resolve({}) })

    expect(response.status).toBe(200)
    expect(prismaMock.frameosToolboxAsset.findMany).toHaveBeenCalledWith({
      where: {
        userId: 'owner-1',
        projectId: 'project-assigned',
        source: 'toolbox',
        bizType: { in: ['video_generation'] },
        type: 'video',
      },
      orderBy: { createdAt: 'desc' },
      take: 80,
    })
  })

  it('excludes character audition and voice-binding rows from toolbox history', async () => {
    await GET(request({
      projectId: 'project-assigned',
      source: 'toolbox',
    }), { params: Promise.resolve({}) })

    expect(prismaMock.frameosToolboxAsset.findMany).toHaveBeenCalledWith({
      where: {
        userId: 'owner-1',
        projectId: 'project-assigned',
        source: 'toolbox',
        bizType: {
          in: [
            'image_generation',
            'video_generation',
            'audio_generation',
            'model3d_generation',
          ],
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 80,
    })
  })

  it('rejects unsupported history sources instead of exposing unrelated generation records', async () => {
    const response = await GET(request({ source: 'production' }), { params: Promise.resolve({}) })

    expect(response.status).toBe(400)
    expect(prismaMock.frameosToolboxAsset.findMany).not.toHaveBeenCalled()
  })

  it('queries the exact requested assets so an old running canvas node is not lost behind pagination', async () => {
    const response = await GET(request({
      projectId: 'project-assigned',
      type: 'image',
      assetIds: 'asset-old,asset-new,asset-old',
      limit: '1',
    }), { params: Promise.resolve({}) })

    expect(response.status).toBe(200)
    expect(prismaMock.frameosToolboxAsset.findMany).toHaveBeenCalledWith({
      where: {
        userId: 'owner-1',
        projectId: 'project-assigned',
        id: { in: ['asset-old', 'asset-new'] },
        type: 'image',
      },
      orderBy: { createdAt: 'desc' },
      take: 2,
    })
  })

  it('rejects an oversized exact-asset query before hitting the database', async () => {
    const response = await GET(request({
      projectId: 'project-assigned',
      assetIds: Array.from({ length: 201 }, (_, index) => `asset-${index}`).join(','),
    }), { params: Promise.resolve({}) })

    expect(response.status).toBe(400)
    expect(prismaMock.frameosToolboxAsset.findMany).not.toHaveBeenCalled()
  })
})
