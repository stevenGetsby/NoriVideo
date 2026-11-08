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
  user: { findMany: vi.fn() },
}))

vi.mock('@/lib/api-auth', () => ({
  requireUserAuth: requireUserAuthMock,
  isErrorResponse: (value: unknown) => value instanceof Response,
}))
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/storage', () => ({
  extractStorageKey: (value: string | null) => value?.startsWith('video/') || value?.startsWith('images/') ? value : null,
  getSignedUrl: (key: string) => `/api/storage/sign?key=${encodeURIComponent(key)}&expires=3600`,
}))

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
  it('shows only persisted real model ids without inferring a historical route', async () => {
    prismaMock.frameosToolboxAsset.findMany.mockResolvedValue([
      { id: 'video-real', userId: 'owner-1', projectId: 'project-assigned', type: 'video', modelId: 'kuaizi::doubao-seedance-2-5-260628', resultUrl: null, materialId: null },
      { id: 'video-legacy', userId: 'owner-1', projectId: 'project-assigned', type: 'video', modelId: 'nori::norivideo2.5', resultUrl: null, materialId: null },
      { id: 'image-legacy', userId: 'owner-1', projectId: 'project-assigned', type: 'image', modelId: 'nori-image-pro', resultUrl: null, materialId: null },
    ])

    const response = await GET(request({ projectId: 'project-assigned' }), { params: Promise.resolve({}) })
    const payload = await response.json() as { assets: Array<{ id: string; modelId: string | null }> }

    expect(payload.assets.map(({ id, modelId }) => ({ id, modelId }))).toEqual([
      { id: 'video-real', modelId: 'doubao-seedance-2-5-260628' },
      { id: 'video-legacy', modelId: null },
      { id: 'image-legacy', modelId: null },
    ])
  })

  it('refreshes playable media from storage keys and disables history caching', async () => {
    prismaMock.frameosToolboxAsset.findMany.mockResolvedValue([{
      id: 'video-1', type: 'video', userId: 'owner-1', projectId: 'project-assigned', resultUrl: 'video/clip.mp4', materialId: null,
      errorMessage: 'HTTP 400 https://media.test/a?X-Tos-Signature=TEST_SECRET',
    }])
    const response = await GET(request({ projectId: 'project-assigned' }), { params: Promise.resolve({}) })
    expect(response.headers.get('cache-control')).toContain('no-store')
    const payload = await response.json()
    expect(payload.assets[0].url).toBe('/api/storage/sign?key=video%2Fclip.mp4&expires=3600')
    expect(payload.assets[0].errorMessage).not.toContain('TEST_SECRET')
  })
  beforeEach(() => {
    vi.clearAllMocks()
    requireUserAuthMock.mockResolvedValue({ session: childSession })
    prismaMock.project.findFirst.mockResolvedValue({ id: 'project-assigned' })
    prismaMock.project.findMany.mockResolvedValue([{ id: 'project-assigned' }])
    prismaMock.frameosToolboxAsset.findMany.mockResolvedValue([])
    prismaMock.task.findMany.mockResolvedValue([])
    prismaMock.frameosMaterial.findMany.mockResolvedValue([])
    prismaMock.user.findMany.mockResolvedValue([{ id: 'owner-1' }, { id: 'storyboard-child' }])
  })

  const sharedUsers = { in: ['owner-1', 'storyboard-child'] }

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

  it('limits legacy unassigned history to its creator for child accounts', async () => {
    const allWorkspaceAssets = [
      { id: 'own-legacy', userId: 'storyboard-child', projectId: null, params: { prompt: '本人历史提示词' }, resultUrl: null, materialId: null },
      { id: 'other-legacy', userId: 'owner-1', projectId: null, params: { prompt: '他人历史提示词' }, resultUrl: null, materialId: null },
      { id: 'shared-project', userId: 'owner-1', projectId: 'project-assigned', params: { prompt: '已分配作品提示词' }, resultUrl: null, materialId: null },
    ]
    prismaMock.project.findMany.mockResolvedValueOnce([{ id: 'project-assigned' }])
    prismaMock.frameosToolboxAsset.findMany.mockImplementationOnce(async (args: {
      where?: {
        userId?: { in?: string[] }
        OR?: Array<{ userId?: string; projectId?: null | { in?: string[] } }>
      }
    }) => {
      const users = args.where?.userId?.in || []
      const clauses = args.where?.OR || []
      return allWorkspaceAssets.filter((asset) => users.includes(asset.userId) && clauses.some((clause) => (
        asset.projectId === null
          ? clause.projectId === null && clause.userId === asset.userId
          : clause.projectId && typeof clause.projectId === 'object' && Boolean(clause.projectId.in?.includes(asset.projectId))
      )))
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
        userId: sharedUsers,
        OR: [
          { projectId: null, userId: 'storyboard-child' },
          { projectId: { in: ['project-assigned'] } },
        ],
        type: 'image',
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 25,
    })
    expect(payload.assets.map((asset) => asset.id)).toEqual(['own-legacy', 'shared-project'])
    expect(JSON.stringify(payload)).toContain('已分配作品提示词')
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
      where: { userId: sharedUsers },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
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
        userId: sharedUsers,
        projectId: 'project-assigned',
        source: 'toolbox',
        bizType: { in: ['video_generation'] },
        type: 'video',
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
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
        userId: sharedUsers,
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
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 80,
    })
  })

  it('rejects unsupported history sources instead of exposing unrelated generation records', async () => {
    const response = await GET(request({ source: 'production' }), { params: Promise.resolve({}) })

    expect(response.status).toBe(400)
    expect(prismaMock.frameosToolboxAsset.findMany).not.toHaveBeenCalled()
  })

  it('continues at the stable time/id cursor and returns the next page boundary', async () => {
    prismaMock.frameosToolboxAsset.findMany.mockResolvedValue(Array.from({ length: 12 }, (_, index) => ({
      id: `asset-${index + 1}`,
      userId: 'owner-1',
      projectId: 'project-assigned',
      createdAt: new Date('2026-11-08T00:00:00Z'),
      resultUrl: null,
      materialId: null,
    })))

    const response = await GET(request({ projectId: 'project-assigned', limit: '12', cursor: 'asset-12' }), { params: Promise.resolve({}) })
    const payload = await response.json()

    expect(prismaMock.frameosToolboxAsset.findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      cursor: { id: 'asset-12' },
      skip: 1,
      take: 12,
    }))
    expect(payload.pagination.nextCursor).toBe('asset-12')
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
        userId: sharedUsers,
        projectId: 'project-assigned',
        id: { in: ['asset-old', 'asset-new'] },
        type: 'image',
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
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
