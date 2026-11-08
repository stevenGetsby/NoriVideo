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
const tx = vi.hoisted(() => ({
  project: { create: vi.fn() },
  projectMember: { create: vi.fn() },
  novelPromotionProject: { create: vi.fn() },
  canvas: { create: vi.fn() },
  mediaObject: {},
}))
const prismaMock = vi.hoisted(() => ({
  userPreference: { findUnique: vi.fn() },
  user: { findMany: vi.fn() },
  $transaction: vi.fn(),
}))
vi.mock('@/lib/api-auth', () => authMock)
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/collaboration/access', () => ({
  getWorkspaceActor: () => ({ actorId: 'member-1', workspaceOwnerId: 'owner-1', role: 'member', isManagement: false }),
  projectReadScopeWhere: vi.fn(),
  requireWorkProjectCreator: vi.fn(),
  workspaceUserWhere: (ownerId: string) => ({ OR: [{ id: ownerId }, { workspaceOwnerId: ownerId }] }),
}))
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

describe('POST /api/projects canvas creation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMock.requireUserAuth.mockResolvedValue({ session })
    prismaMock.userPreference.findUnique.mockResolvedValue(null)
    prismaMock.user.findMany.mockResolvedValue([])
    prismaMock.$transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) => callback(tx))
    tx.project.create.mockResolvedValue({ id: 'project-1', name: '新作品', workId: 'work-1', createdById: 'member-1' })
    tx.projectMember.create.mockResolvedValue({})
    tx.novelPromotionProject.create.mockResolvedValue({ id: 'novel-1' })
    tx.canvas.create.mockResolvedValue({ id: 'canvas-1', projectId: 'project-1', title: '主画布' })
  })

  it('creates the work, creator membership and blank canvas atomically', async () => {
    const { POST } = await import('@/app/api/projects/route')
    const response = await POST(request({ creationMode: 'canvas', createBlankCanvas: 'true' }), routeContext)

    expect(response.status).toBe(201)
    expect(prismaMock.$transaction).toHaveBeenCalledOnce()
    expect(tx.projectMember.create).toHaveBeenCalledWith({ data: { projectId: 'project-1', userId: 'member-1', role: 'owner' } })
    expect(tx.canvas.create).toHaveBeenCalledWith({ data: {
      projectId: 'project-1', userId: 'member-1', title: '主画布', viewport: { x: 0, y: 0, zoom: 1 },
    }, select: { id: true, projectId: true, title: true } })
    await expect(response.json()).resolves.toMatchObject({
      work: { id: 'project-1' }, canvas: { id: 'canvas-1', projectId: 'project-1' },
    })
  })

  it('preserves the workflow path without an implicit canvas', async () => {
    const { POST } = await import('@/app/api/projects/route')
    const response = await POST(request({ creationMode: 'workflow' }), routeContext)
    expect(response.status).toBe(201)
    expect(tx.canvas.create).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toMatchObject({ canvas: null })
  })

  it.each([
    { creationMode: 'paid' },
    { createBlankCanvas: 1 },
    { createBlankCanvas: 'yes' },
  ])('rejects invalid creation input before writing: %o', async (body) => {
    const { POST } = await import('@/app/api/projects/route')
    const response = await POST(request(body), routeContext)
    expect(response.status).toBe(400)
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it('does not return a successful project when canvas creation fails', async () => {
    tx.canvas.create.mockRejectedValue(new Error('canvas storage unavailable'))
    const { POST } = await import('@/app/api/projects/route')
    const response = await POST(request({ creationMode: 'canvas' }), routeContext)
    expect(response.status).toBeGreaterThanOrEqual(500)
    expect(prismaMock.$transaction).toHaveBeenCalledOnce()
    expect(tx.canvas.create).toHaveBeenCalledOnce()
  })
})
