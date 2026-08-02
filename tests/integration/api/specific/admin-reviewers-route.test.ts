import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../../helpers/request'

const requireAdminAuthMock = vi.hoisted(() => vi.fn())
const syncProjectAssignmentsMock = vi.hoisted(() => vi.fn())
const prismaMock = vi.hoisted(() => ({
  user: { findMany: vi.fn() },
  project: { findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
  projectMember: { findMany: vi.fn(), upsert: vi.fn(), update: vi.fn(), delete: vi.fn() },
  $transaction: vi.fn(async (operations: Array<Promise<unknown>>) => await Promise.all(operations)),
}))

vi.mock('@/lib/api-auth', () => ({
  requireAdminAuth: requireAdminAuthMock,
  isErrorResponse: (value: unknown) => value instanceof Response,
  forbidden: (message: string) => Response.json({ message }, { status: 403 }),
}))
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/collaboration/assignments', () => ({
  syncProjectAssignmentsForProject: syncProjectAssignmentsMock,
}))
vi.mock('@/lib/logging/core', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/logging/core')>(),
  logInfo: vi.fn(),
}))

const session = {
  user: {
    id: 'platform-1',
    actorId: 'platform-1',
    role: 'super_admin',
  },
}

describe('platform reviewer assignment route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireAdminAuthMock.mockResolvedValue({ session })
  })

  it('returns reviewers and their project-level grants grouped by management workspace', async () => {
    prismaMock.user.findMany
      .mockResolvedValueOnce([{ id: 'manager-1', name: 'lanmiao', status: 'active' }])
      .mockResolvedValueOnce([{ id: 'reviewer-1', name: 'review-01', roleLabel: '审核员', status: 'active', workspaceOwnerId: 'manager-1' }])
    prismaMock.project.findMany.mockResolvedValue([{ id: 'project-1', name: '短剧 A', userId: 'manager-1', collaborationMode: 'team', work: { name: '作品 A' } }])
    prismaMock.projectMember.findMany.mockResolvedValue([{ projectId: 'project-1', userId: 'reviewer-1' }])

    const { GET } = await import('@/app/api/admin/reviewers/route')
    const response = await GET(buildMockRequest({ path: '/api/admin/reviewers', method: 'GET' }), { params: Promise.resolve({}) })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      workspaces: [{
        manager: { id: 'manager-1', username: 'lanmiao' },
        reviewers: [{ id: 'reviewer-1', username: 'review-01' }],
        projects: [{ id: 'project-1', reviewerIds: ['reviewer-1'] }],
      }],
    })
  })

  it('stores review-only membership and enables team assignments for a solo project', async () => {
    prismaMock.project.findFirst.mockResolvedValue({ id: 'project-1', name: '短剧 A', userId: 'manager-1', collaborationMode: 'solo' })
    prismaMock.user.findMany
      .mockResolvedValueOnce([{ id: 'reviewer-1' }])
      .mockResolvedValueOnce([{ id: 'reviewer-1' }])
    prismaMock.projectMember.findMany.mockResolvedValue([])
    prismaMock.projectMember.upsert.mockResolvedValue({ id: 'membership-1' })
    prismaMock.project.update.mockResolvedValue({ id: 'project-1', collaborationMode: 'team' })
    syncProjectAssignmentsMock.mockResolvedValue(undefined)

    const { PUT } = await import('@/app/api/admin/reviewers/route')
    const response = await PUT(buildMockRequest({
      path: '/api/admin/reviewers',
      method: 'PUT',
      body: { projectId: 'project-1', reviewerIds: ['reviewer-1'] },
    }), { params: Promise.resolve({}) })

    expect(response.status).toBe(200)
    expect(prismaMock.projectMember.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        projectId: 'project-1',
        userId: 'reviewer-1',
        canManageAssignments: false,
        canReviewAssignments: true,
      }),
    }))
    expect(prismaMock.project.update).toHaveBeenCalledWith({
      where: { id: 'project-1' },
      data: { collaborationMode: 'team' },
    })
    expect(syncProjectAssignmentsMock).toHaveBeenCalledWith({ projectId: 'project-1', workspaceOwnerId: 'manager-1' })
  })

  it('rejects reviewers from another workspace', async () => {
    prismaMock.project.findFirst.mockResolvedValue({ id: 'project-1', name: '短剧 A', userId: 'manager-1', collaborationMode: 'team' })
    prismaMock.user.findMany.mockResolvedValueOnce([])

    const { PUT } = await import('@/app/api/admin/reviewers/route')
    const response = await PUT(buildMockRequest({
      path: '/api/admin/reviewers',
      method: 'PUT',
      body: { projectId: 'project-1', reviewerIds: ['reviewer-other'] },
    }), { params: Promise.resolve({}) })

    expect(response.status).toBe(400)
    expect(prismaMock.projectMember.upsert).not.toHaveBeenCalled()
  })
})
