import { NextRequest, NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const authMock = vi.hoisted(() => ({
  requireUserAuth: vi.fn(),
  isErrorResponse: (value: unknown) => value instanceof NextResponse,
}))
const prismaMock = vi.hoisted(() => ({
  project: { count: vi.fn(), findMany: vi.fn() },
  usageCost: { findMany: vi.fn() },
  novelPromotionProject: { findMany: vi.fn() },
  workflowStageState: { findMany: vi.fn() },
  task: { findMany: vi.fn() },
}))
vi.mock('@/lib/api-auth', () => authMock)
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

function createProject(id: string) {
  const timestamp = new Date('2026-11-08T08:00:00.000Z')
  return {
    id,
    name: `作品 ${id}`,
    description: null,
    userId: 'owner-1',
    workId: 'work-1',
    createdById: 'member-1',
    createdAt: timestamp,
    updatedAt: timestamp,
    lastAccessedAt: null,
    deletedAt: null,
    work: { name: '共享项目' },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  authMock.requireUserAuth.mockResolvedValue({
    session: { user: { id: 'owner-1', actorId: 'member-1', workspaceOwnerId: 'owner-1', role: 'writer' } },
  })
  prismaMock.project.count.mockResolvedValue(1)
  prismaMock.project.findMany.mockResolvedValue([createProject('project-1')])
  prismaMock.usageCost.findMany.mockResolvedValue([])
  prismaMock.novelPromotionProject.findMany.mockResolvedValue([])
  prismaMock.workflowStageState.findMany.mockResolvedValue([])
  prismaMock.task.findMany.mockResolvedValue([])
})

describe('projects route workflow summary source', () => {
  it('aggregates owner and legacy child records only for ACL-readable works', async () => {
    const { GET } = await import('@/app/api/projects/route')
    prismaMock.usageCost.findMany.mockResolvedValue([
      { projectId: 'project-1', cost: 2.5, action: 'image_panel', apiType: 'image', model: 'nori-image', metadata: null },
      { projectId: 'project-1', cost: 1.5, action: 'video_panel', apiType: 'video', model: 'seedance', metadata: null },
    ])
    prismaMock.workflowStageState.findMany.mockResolvedValue([{
      projectId: 'project-1', scopeId: 'project', stageKey: 'storyboard', status: 'running', progress: 48,
      reviewState: null, blocker: null, errorMessage: null, approvedAt: null,
      updatedAt: new Date('2026-11-08T09:00:00.000Z'),
    }])
    prismaMock.task.findMany.mockResolvedValue([
      { projectId: 'project-1', type: 'image_panel', targetType: 'NovelPromotionPanel', errorMessage: null },
    ])
    const response = await GET(new NextRequest('http://localhost/api/projects?page=1&pageSize=12') as never, { params: Promise.resolve({}) })
    expect(response.status).toBe(200)
    expect(prismaMock.project.findMany.mock.calls[0][0].where).toEqual({
      userId: 'owner-1', deletedAt: null,
      work: {
        OR: [
          { createdById: 'member-1' },
          { members: { some: { userId: 'member-1' } } },
        ],
      },
    })
    expect(prismaMock.project.count).toHaveBeenCalledWith({
      where: {
        userId: 'owner-1', deletedAt: null,
        work: {
          OR: [
            { createdById: 'member-1' },
            { members: { some: { userId: 'member-1' } } },
          ],
        },
      },
    })
    for (const model of [prismaMock.usageCost, prismaMock.workflowStageState, prismaMock.task]) {
      expect(model.findMany.mock.calls[0][0].where).toMatchObject({ projectId: { in: ['project-1'] } })
      expect(model.findMany.mock.calls[0][0].where).not.toHaveProperty('userId')
    }
    await expect(response.json()).resolves.toMatchObject({
      projects: [{ id: 'project-1', workId: 'work-1', totalCost: 4, workflowSummary: { currentStage: 'storyboard', status: 'running', progress: 48, activeTaskCount: 1 } }],
    })
  })

  it('does not issue aggregate queries for a member without readable works', async () => {
    const { GET } = await import('@/app/api/projects/route')
    prismaMock.project.count.mockResolvedValueOnce(0)
    prismaMock.project.findMany.mockResolvedValueOnce([])
    const response = await GET(new NextRequest('http://localhost/api/projects') as never, { params: Promise.resolve({}) })
    expect(response.status).toBe(200)
    for (const model of [prismaMock.usageCost, prismaMock.workflowStageState, prismaMock.task]) {
      expect(model.findMany).not.toHaveBeenCalled()
    }
    await expect(response.json()).resolves.toMatchObject({ projects: [], pagination: { total: 0, totalPages: 0 } })
  })
})
