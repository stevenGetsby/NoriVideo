import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../../helpers/request'

const dates = vi.hoisted(() => ({
  createdAt: new Date('2026-10-13T00:00:00Z'),
  updatedAt: new Date('2026-10-13T00:00:00Z'),
}))
const auth = vi.hoisted(() => ({
  requireUserAuth: vi.fn(async () => ({
    session: { user: { id: 'manager', role: 'admin' } },
  })),
  isErrorResponse: (value: unknown) => value instanceof Response,
}))
const db = vi.hoisted(() => ({
  work: {
    count: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    deleteMany: vi.fn(),
  },
  project: { create: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
  user: { findMany: vi.fn() },
  $transaction: vi.fn(),
}))
vi.mock('@/lib/api-auth', () => auth)
vi.mock('@/lib/prisma', () => ({ prisma: db }))

describe('project -> work API contract, compatible with existing storage IDs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    db.$transaction.mockImplementation(async (callback: (tx: typeof db) => unknown) => callback(db))
    db.work.count.mockResolvedValue(1)
    db.work.findMany.mockResolvedValue([{
      id: 'stored-parent', name: '项目甲', createdById: 'manager', ...dates,
      createdBy: { id: 'manager', name: 'Manager', role: 'admin' },
      _count: { projects: 1 }, members: [],
      projects: [{ id: 'stored-child', name: '作品 A', workId: 'stored-parent', ...dates }],
    }])
    db.work.findFirst.mockResolvedValue({
      id: 'stored-parent', name: '项目甲', workspaceOwnerId: 'manager', projects: [],
    })
    db.work.create.mockResolvedValue({ id: 'new-parent', name: '新项目', ...dates })
    db.work.update.mockResolvedValue({ id: 'stored-parent', name: '改名后的项目', ...dates })
    db.work.deleteMany.mockResolvedValue({ count: 0 })
  })

  it('GET returns projects containing works without regenerating either ID', async () => {
    const route = await import('@/app/api/works/route')
    const response = await route.GET(buildMockRequest({ path: '/api/works', method: 'GET' }), {
      params: Promise.resolve({}),
    })
    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload.projectHierarchy).toMatchObject({
      version: 2,
      projects: [{
        id: 'stored-parent', kind: 'project', name: '项目甲', workCount: 1,
        works: [{ id: 'stored-child', kind: 'work', projectId: 'stored-parent', name: '作品 A' }],
      }],
    })
    expect(payload.works[0].id).toBe(payload.projectHierarchy.projects[0].id)
    expect(payload.works[0].projects[0].id).toBe(payload.projectHierarchy.projects[0].works[0].id)
    expect(db.project.create).not.toHaveBeenCalled()
  })

  it('POST creates only a parent project, not a task or production work', async () => {
    const route = await import('@/app/api/works/route')
    const response = await route.POST(buildMockRequest({
      path: '/api/works', method: 'POST', body: { name: '新项目' },
    }), { params: Promise.resolve({}) })
    expect(response.status).toBe(201)
    const payload = await response.json()
    expect(payload.project).toMatchObject({ id: 'new-parent', kind: 'project', name: '新项目' })
    expect(payload.work.id).toBe(payload.project.id)
    expect(db.work.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ name: '新项目', workspaceOwnerId: 'manager' }),
    }))
    expect(db.project.create).not.toHaveBeenCalled()
  })

  it('PATCH renames only the selected parent project', async () => {
    const route = await import('@/app/api/works/[workId]/route')
    const response = await route.PATCH(buildMockRequest({
      path: '/api/works/stored-parent', method: 'PATCH', body: { name: '改名后的项目' },
    }), { params: Promise.resolve({ workId: 'stored-parent' }) })
    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload.project).toMatchObject({ id: 'stored-parent', kind: 'project', name: '改名后的项目' })
    expect(db.work.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'stored-parent' }, data: { name: '改名后的项目' },
    }))
    expect(db.project.updateMany).not.toHaveBeenCalled()
  })

  it('DELETE protects a parent project even when its only works are recycled', async () => {
    const route = await import('@/app/api/works/[workId]/route')
    const response = await route.DELETE(buildMockRequest({
      path: '/api/works/stored-parent', method: 'DELETE',
    }), { params: Promise.resolve({ workId: 'stored-parent' }) })
    expect(response.status).toBe(409)
    expect(db.work.deleteMany).toHaveBeenCalledWith({
      where: { id: 'stored-parent', projects: { none: {} } },
    })
    expect(db.project.updateMany).not.toHaveBeenCalled()
  })

  it('moves an existing work to a project without changing its task or media identity', async () => {
    db.project.findMany.mockResolvedValue([{
      id: 'stored-child', workId: 'old-parent', work: { createdById: 'manager', members: [] }, members: [],
    }])
    db.project.updateMany.mockResolvedValue({ count: 1 })
    const route = await import('@/app/api/works/projects/move/route')
    const response = await route.POST(buildMockRequest({
      path: '/api/works/projects/move', method: 'POST',
      body: { workIds: ['stored-child'], targetProjectId: 'stored-parent' },
    }), { params: Promise.resolve({}) })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ moved: 1, targetProjectId: 'stored-parent' })
    expect(db.project.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['stored-child'] }, userId: 'manager', workId: 'old-parent', deletedAt: null },
      data: { workId: 'stored-parent' },
    })
    expect(db.project.create).not.toHaveBeenCalled()
  })

  it('returns 400 for conflicting source aliases without touching any work', async () => {
    const route = await import('@/app/api/works/projects/move/route')
    const response = await route.POST(buildMockRequest({
      path: '/api/works/projects/move', method: 'POST',
      body: { workIds: ['a'], projectIds: ['b'], targetProjectId: 'stored-parent' },
    }), { params: Promise.resolve({}) })
    expect(response.status).toBe(400)
    expect(db.project.findMany).not.toHaveBeenCalled()
    expect(db.$transaction).not.toHaveBeenCalled()
  })

  it('returns 409 when a work was deleted after reading the source', async () => {
    db.project.findMany.mockResolvedValue([{
      id: 'stored-child', workId: 'old-parent', work: { createdById: 'manager', members: [] }, members: [],
    }])
    db.project.updateMany.mockResolvedValueOnce({ count: 0 })
    const route = await import('@/app/api/works/projects/move/route')
    const response = await route.POST(buildMockRequest({
      path: '/api/works/projects/move', method: 'POST',
      body: { workIds: ['stored-child'], targetProjectId: 'stored-parent' },
    }), { params: Promise.resolve({}) })
    expect(response.status).toBe(409)
    expect(db.project.updateMany.mock.calls[0][0].where.deletedAt).toBeNull()
    expect(db.project.create).not.toHaveBeenCalled()
  })

  it.each([null, [], 'not-an-object'])('rejects invalid JSON bodies with 400: %j', async (body) => {
    const route = await import('@/app/api/works/projects/move/route')
    const response = await route.POST(buildMockRequest({
      path: '/api/works/projects/move', method: 'POST', body,
    }), { params: Promise.resolve({}) })
    expect(response.status).toBe(400)
    expect(db.project.findMany).not.toHaveBeenCalled()
    expect(db.$transaction).not.toHaveBeenCalled()
  })
})
