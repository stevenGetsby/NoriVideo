import { beforeEach, describe, expect, it, vi } from 'vitest'
import { projectParticipantWhere } from '@/lib/collaboration/access'
import { buildMockRequest } from '../../../helpers/request'

const prismaMock = vi.hoisted(() => ({
  project: {
    findFirst: vi.fn(async () => ({ id: 'project-1' })),
    findMany: vi.fn(async () => [{ id: 'project-1', name: '短剧作品' }]),
  },
  user: {
    findMany: vi.fn(async () => [
      { id: 'user-1', name: '管理员' },
      { id: 'creator-1', name: '资产师甲' },
      { id: 'storyboard-child', name: '分镜师' },
    ]),
  },
  frameosMaterial: {
    count: vi.fn(async () => 0),
    findMany: vi.fn(async () => [{
      id: 'material-1',
      userId: 'user-1',
      projectId: 'project-1',
      ownerName: '资产师甲',
      title: '雨夜场景',
      type: 'image',
      source: 'upload',
      status: 'ready',
      isFavorited: true,
      resultUrl: 'https://assets.test/rain.jpg',
      storageKey: null,
      createdAt: new Date('2026-07-17T00:00:00.000Z'),
      updatedAt: new Date('2026-07-17T00:00:00.000Z'),
    }]),
  },
}))
const syncGeneratedImagesToMaterialLibrary = vi.hoisted(() => vi.fn(async () => undefined))
const requireUserAuthMock = vi.hoisted(() => vi.fn())
const requireProjectAuthLightMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/api-auth', () => ({
  requireUserAuth: requireUserAuthMock,
  requireProjectAuthLight: requireProjectAuthLightMock,
  requireUserPermission: vi.fn(),
  isErrorResponse: (value: unknown) => value instanceof Response,
}))
vi.mock('@/lib/frameos/material-upload', () => ({ uploadFrameosMaterial: vi.fn() }))
vi.mock('@/lib/frameos/material-service', () => ({
  syncGeneratedImagesToMaterialLibrary,
}))
vi.mock('@/lib/storage', () => ({
  extractStorageKey: (value: string | null) => value?.startsWith('images/') || value?.startsWith('voice/') ? value : null,
  getSignedUrl: (key: string) => `/api/storage/sign?key=${encodeURIComponent(key)}`,
}))

import { GET } from '@/app/api/frameos/materials/route'

describe('FrameOS material list filters', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const session = {
      user: {
        id: 'user-1',
        actorId: 'user-1',
        workspaceOwnerId: 'user-1',
        role: 'admin',
        permissions: ['assetRead', 'assetWrite'],
      },
    }
    requireUserAuthMock.mockResolvedValue({ session })
    requireProjectAuthLightMock.mockResolvedValue({ session, project: { id: 'project-1', userId: 'user-1', name: '短剧作品' } })
    prismaMock.project.findMany.mockResolvedValue([{ id: 'project-1', name: '短剧作品' }])
    prismaMock.user.findMany.mockResolvedValue([
      { id: 'user-1', name: '管理员' },
      { id: 'creator-1', name: '资产师甲' },
      { id: 'storyboard-child', name: '分镜师' },
    ])
    prismaMock.frameosMaterial.count.mockResolvedValue(0)
  })

  it('queries persisted favorite, source, project, creator, and creation-time fields', async () => {
    const response = await GET(buildMockRequest({
      path: '/api/frameos/materials',
      method: 'GET',
      query: {
        projectId: 'project-1',
        available: '1',
        type: 'image',
        source: 'upload',
        favorite: '1',
        creator: '资产师甲',
        createdFrom: '2026-07-01T00:00:00.000Z',
        createdTo: '2026-07-18T00:00:00.000Z',
      },
    }), { params: Promise.resolve({}) })
    const payload = await response.json() as { materials?: Array<{ projectName?: string }> }

    expect(response.status).toBe(200)
    expect(prismaMock.frameosMaterial.findMany).toHaveBeenCalledWith({
      where: {
        userId: { in: ['user-1', 'creator-1', 'storyboard-child'] },
        projectId: { in: ['project-1', 'global', 'global-asset-hub'] },
        deletedAt: null,
        type: 'image',
        source: 'upload',
        isFavorited: true,
        OR: [
          { ownerName: { contains: '资产师甲' } },
          { userId: { in: ['creator-1'] } },
        ],
        createdAt: {
          gte: new Date('2026-07-01T00:00:00.000Z'),
          lte: new Date('2026-07-18T00:00:00.000Z'),
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 200,
    })
    expect(payload.materials?.[0]?.projectName).toBe('短剧作品')
  })

  it('returns real creator choices and performs exact dropdown filtering', async () => {
    const response = await GET(buildMockRequest({
      path: '/api/frameos/materials', method: 'GET',
      query: { creator: '资产师甲', creatorExact: '1', projectId: 'project-1', available: '0' },
    }), { params: Promise.resolve({}) })
    expect(response.status).toBe(200)
    expect(prismaMock.frameosMaterial.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        projectId: { in: ['project-1'] },
        OR: [{ ownerName: { equals: '资产师甲' } }, { userId: { in: ['creator-1'] }, OR: [{ ownerName: null }, { ownerName: '' }] }],
      }),
    }))
    expect(await response.json()).toMatchObject({
      creators: [{ id: 'user-1', name: '管理员' }, { id: 'creator-1', name: '资产师甲' }, { id: 'storyboard-child', name: '分镜师' }],
    })
  })

  it('limits an unscoped child-account query to its management workspace plus account materials', async () => {
    requireUserAuthMock.mockResolvedValueOnce({
      session: {
        user: {
          id: 'user-1',
          actorId: 'storyboard-child',
          workspaceOwnerId: 'user-1',
          role: 'storyboard',
          permissions: ['assetRead', 'storyboardWrite'],
        },
      },
    })
    prismaMock.project.findMany.mockResolvedValueOnce([{ id: 'project-1', name: '短剧作品' }])

    const response = await GET(buildMockRequest({
      path: '/api/frameos/materials',
      method: 'GET',
      query: { available: '1', sync: '1' },
    }), { params: Promise.resolve({}) })

    expect(response.status).toBe(200)
    expect(prismaMock.project.findMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        deletedAt: null,
        ...projectParticipantWhere('storyboard-child'),
      },
      select: { id: true, name: true },
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
    })
    expect(prismaMock.frameosMaterial.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        userId: { in: ['user-1', 'creator-1', 'storyboard-child'] },
        projectId: { in: ['project-1', 'global', 'global-asset-hub'] },
        deletedAt: null,
      }),
    }))
    expect(syncGeneratedImagesToMaterialLibrary).not.toHaveBeenCalled()
  })

  it('keeps cursor pagination inside the authenticated project scope', async () => {
    const response = await GET(buildMockRequest({
      path: '/api/frameos/materials', method: 'GET', query: { projectId: 'project-1', cursor: 'material-older', limit: '1' },
    }), { params: Promise.resolve({}) })
    expect(response.status).toBe(200)
    expect(prismaMock.frameosMaterial.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ projectId: { in: ['project-1'] }, userId: { in: ['user-1', 'creator-1', 'storyboard-child'] } }),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], cursor: { id: 'material-older' }, skip: 1, take: 1,
    }))
    expect((await response.json()).pagination.nextCursor).toBe('material-1')
  })
})
