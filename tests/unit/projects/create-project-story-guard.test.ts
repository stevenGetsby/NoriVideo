import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../helpers/request'

const session = {
  user: {
    id: 'owner-1', actorId: 'member-1', workspaceOwnerId: 'owner-1',
    role: 'member', permissions: [],
  },
}
const authMock = vi.hoisted(() => ({
  requireUserAuth: vi.fn(),
  isErrorResponse: (value: unknown) => value instanceof Response,
}))
const accessMock = vi.hoisted(() => ({
  getWorkspaceActor: vi.fn(() => ({ actorId: 'member-1', workspaceOwnerId: 'owner-1', role: 'member', isManagement: false })),
  projectReadScopeWhere: vi.fn(),
  requireWorkProjectCreator: vi.fn(),
  workspaceUserWhere: vi.fn((ownerId: string) => ({ OR: [{ id: ownerId }, { workspaceOwnerId: ownerId }] })),
}))
const prismaMock = vi.hoisted(() => ({
  userPreference: { findUnique: vi.fn() },
  user: { findMany: vi.fn() },
  $transaction: vi.fn(),
}))
vi.mock('@/lib/api-auth', () => authMock)
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/collaboration/access', () => accessMock)
vi.mock('@/lib/projects/style-reference-upload', () => ({
  cleanupUploadedProjectStyleReferences: vi.fn(),
  persistProjectStyleReferenceMedia: vi.fn().mockResolvedValue([]),
  prepareProjectStyleReferences: vi.fn().mockResolvedValue([]),
  uploadProjectStyleReferences: vi.fn().mockResolvedValue([]),
}))
vi.mock('@/lib/logging/core', () => ({ logError: vi.fn(), logInfo: vi.fn(), createScopedLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() }) }))

function request(body: Record<string, unknown>) {
  return buildMockRequest({ path: '/api/projects', method: 'POST', body: { name: '新作品', workId: 'work-1', ...body } })
}

const routeContext = { params: Promise.resolve({}) }

describe('POST /api/projects story guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMock.requireUserAuth.mockResolvedValue({ session })
    accessMock.requireWorkProjectCreator.mockResolvedValue({ work: { id: 'work-1', productLine: 'story' } })
  })

  it('rejects creating an ordinary 作品 inside a 影游 work', async () => {
    const { POST } = await import('@/app/api/projects/route')
    const response = await POST(request({}), routeContext)

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'CONFLICT', message: '影游章节请在影游画布里新建' },
    })
    expect(accessMock.requireWorkProjectCreator).toHaveBeenCalledWith(session, 'work-1')
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it('keeps ordinary works on the existing creation path', async () => {
    accessMock.requireWorkProjectCreator.mockResolvedValue({ work: { id: 'work-1', productLine: 'canvas' } })
    const tx = {
      project: { create: vi.fn().mockResolvedValue({ id: 'project-1', name: '新作品', workId: 'work-1', createdById: 'member-1' }) },
      projectMember: { create: vi.fn().mockResolvedValue({}) },
      novelPromotionProject: { create: vi.fn().mockResolvedValue({ id: 'novel-1' }) },
      canvas: { create: vi.fn() },
      mediaObject: {},
    }
    prismaMock.userPreference.findUnique.mockResolvedValue(null)
    prismaMock.user.findMany.mockResolvedValue([])
    prismaMock.$transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) => callback(tx))

    const { POST } = await import('@/app/api/projects/route')
    const response = await POST(request({}), routeContext)

    expect(response.status).toBe(201)
    expect(tx.project.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ creationMode: 'workflow' }),
    }))
  })
})
