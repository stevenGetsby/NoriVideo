import { beforeEach, describe, expect, it, vi } from 'vitest'
import { withAccountPermissionContext } from '@/lib/account/request-context'
import { requiredPermissionsForApiPath } from '@/lib/account/permissions'

const getServerSessionMock = vi.hoisted(() => vi.fn(async () => ({
  user: { id: 'user-1', name: 'User 1', email: 'user1@test.local' },
})))

const prismaMock = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
  },
  project: {
    findFirst: vi.fn(),
  },
  userBalance: {
    findUnique: vi.fn(),
  },
}))

vi.mock('next-auth/next', () => ({
  getServerSession: getServerSessionMock,
}))

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => ({
    get: vi.fn(() => ''),
  })),
}))

vi.mock('@/lib/auth', () => ({
  authOptions: {},
}))

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))

vi.mock('@/lib/prisma-retry', () => ({
  withPrismaRetry: async <T>(operation: () => Promise<T>) => operation(),
}))

vi.mock('@/lib/test-mode', () => ({
  getOrCreateTestModeSession: vi.fn(),
  isTestModeEnabled: vi.fn(() => false),
}))

vi.mock('@/lib/config-service', () => ({
  extractModelKey: (value: unknown) => value,
}))

describe('project auth scope', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-1',
      role: 'writer',
      status: 'active',
      workspaceOwnerId: null,
      parentAccountId: null,
      parentAccount: null,
    })
  })

  it('blocks restricted accounts on story and asset library routes without blocking ordinary canvas routes', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-1', role: 'writer', status: 'active',
      permissions: ['read', 'deny:story-canvas', 'deny:asset-library'],
    })
    const { NextRequest } = await import('next/server')
    const { apiHandler } = await import('@/lib/api-errors')
    const { requireUserAuth, isErrorResponse } = await import('@/lib/api-auth')
    const handle = apiHandler(async () => {
      const auth = await requireUserAuth()
      return isErrorResponse(auth) ? auth : Response.json({ success: true })
    })
    for (const path of ['/api/interactive', '/api/interactive/story-1/chapters', '/api/asset-hub/characters', '/api/assets', '/api/frameos/materials/asset-1/download']) {
      expect((await handle(new NextRequest(`http://localhost${path}`), { params: Promise.resolve({}) })).status).toBe(403)
    }
    expect((await handle(new NextRequest('http://localhost/api/projects/project-1/canvas'), { params: Promise.resolve({ projectId: 'project-1' }) })).status).toBe(200)
  })

  it('cannot reach a story canvas through the ordinary project route', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-1', role: 'writer', status: 'active', workspaceOwnerId: 'owner-1',
      permissions: ['read', 'deny:story-canvas'],
    })
    prismaMock.project.findFirst.mockResolvedValue({
      work: { productLine: 'story', createdById: null, members: [{ id: 'membership-1' }] },
    })
    const { NextRequest } = await import('next/server')
    const { apiHandler } = await import('@/lib/api-errors')
    const { requireUserAuth, isErrorResponse } = await import('@/lib/api-auth')
    const handle = apiHandler(async () => {
      const auth = await requireUserAuth()
      return isErrorResponse(auth) ? auth : Response.json({ success: true })
    })
    const response = await handle(new NextRequest('http://localhost/api/projects/project-1/canvas'), { params: Promise.resolve({ projectId: 'project-1' }) })
    expect(response.status).toBe(404)
  })

  it('filters story works and projects only for the account with the restriction', async () => {
    const { workReadScopeWhere, projectReadScopeWhere } = await import('@/lib/collaboration/access')
    const member = { id: 'user-1', role: 'writer' as const, workspaceOwnerId: 'owner-1' }
    const restricted = { user: { ...member, contentRestrictions: ['story-canvas' as const] } }
    expect(workReadScopeWhere(restricted)).toMatchObject({ productLine: { not: 'story' } })
    expect(projectReadScopeWhere(restricted)).toMatchObject({ work: { productLine: { not: 'story' } } })
    expect(workReadScopeWhere({ user: member })).not.toHaveProperty('productLine')
    expect(projectReadScopeWhere({ user: member })).not.toHaveProperty('work.productLine')
  })

  it('scopes light project auth lookup by current user and returns not found on scoped miss', async () => {
    prismaMock.project.findFirst.mockResolvedValueOnce(null)
    const { requireProjectAuthLight } = await import('@/lib/api-auth')

    const result = await requireProjectAuthLight('project-other')
    const body = await (result as Response).json() as { error?: { code?: string } }

    expect(result).toBeInstanceOf(Response)
    expect((result as Response).status).toBe(404)
    expect(body.error?.code).toBe('NOT_FOUND')
    expect(prismaMock.project.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'project-other',
        userId: 'user-1',
        deletedAt: null,
      },
    })
  })

  it('scopes full project auth lookup by current user before loading novel promotion data', async () => {
    prismaMock.project.findFirst.mockResolvedValueOnce({
      id: 'project-1',
      userId: 'user-1',
      name: 'Project 1',
      novelPromotionData: {
        id: 'novel-project-1',
        analysisModel: 'openai::gpt-4o-mini',
      },
    })
    const { requireProjectAuth, isErrorResponse } = await import('@/lib/api-auth')

    const result = await requireProjectAuth('project-1', {
      include: { characters: true, episodes: true },
    })

    expect(isErrorResponse(result)).toBe(false)
    expect(prismaMock.project.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'project-1',
        userId: 'user-1',
        deletedAt: null,
      },
      include: {
        novelPromotionData: {
          include: {
            characters: true,
            episodes: true,
          },
        },
      },
    })
  })

  it('returns 404 to a subaccount on a teammate 作品 named by the route, even via requireUserAuth', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: 'user-1', role: 'writer', permissions: [], status: 'active', sessionVersion: 0,
      workspaceOwnerId: 'owner-1', parentAccountId: 'owner-1',
      parentAccount: { id: 'owner-1', role: 'admin', status: 'active' },
      coinCredits: null, balance: null,
    })
    prismaMock.userBalance.findUnique.mockResolvedValueOnce({ balance: 0 })
    prismaMock.project.findFirst.mockResolvedValueOnce({
      createdById: 'user-2',
      members: [],
      workflowAssignments: [],
      work: { createdById: 'owner-1', members: [] },
    })
    const { requireUserAuth, isErrorResponse } = await import('@/lib/api-auth')
    const result = await withAccountPermissionContext([], () => requireUserAuth(), 'project-other')
    expect(isErrorResponse(result)).toBe(true)
    expect((result as Response).status).toBe(404)
    expect(prismaMock.project.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'project-other', userId: 'owner-1' },
    }))
  })

  it.each(['writer', 'asset', 'storyboard', 'reviewer'])(
    'lets %s pass the secondary-edit and deletion account gates for object-level authorization',
    async (role) => {
      prismaMock.user.findUnique.mockResolvedValue({
        id: 'user-1', role, permissions: [], status: 'active',
        workspaceOwnerId: null, parentAccountId: null, parentAccount: null,
      })
      prismaMock.project.findFirst.mockResolvedValue({
        id: 'project-1', userId: 'user-1', name: 'Project 1',
      })
      const { requireProjectAuthLight, isErrorResponse } = await import('@/lib/api-auth')
      const edited = await withAccountPermissionContext(
        requiredPermissionsForApiPath('/api/projects/project-1', 'PATCH'),
        () => requireProjectAuthLight('project-1'),
      )
      expect(isErrorResponse(edited)).toBe(false)
      expect(prismaMock.project.findFirst).toHaveBeenCalledWith({
        where: { id: 'project-1', userId: 'user-1', deletedAt: null },
      })
      prismaMock.project.findFirst.mockClear()
      const deleted = await withAccountPermissionContext(
        requiredPermissionsForApiPath('/api/projects/project-1', 'DELETE'),
        () => requireProjectAuthLight('project-1'),
      )
      expect(isErrorResponse(deleted)).toBe(false)
      expect(prismaMock.project.findFirst).toHaveBeenCalledWith({
        where: { id: 'project-1', userId: 'user-1', deletedAt: null },
      })
    },
  )
})
