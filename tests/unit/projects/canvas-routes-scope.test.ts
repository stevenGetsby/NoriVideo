import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../helpers/request'

const authMock = vi.hoisted(() => ({
  requireProjectAuthLight: vi.fn(async (projectId: string) => ({
    session: { user: { id: 'user-1' } },
    project: { id: projectId, userId: 'user-1' },
  })),
  isErrorResponse: (value: unknown) => value instanceof Response,
}))

const prismaMock = vi.hoisted(() => ({
  canvas: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  project: {
    findFirst: vi.fn(),
  },
  canvasNode: {
    findFirst: vi.fn(),
    delete: vi.fn(),
    findMany: vi.fn(),
    deleteMany: vi.fn(),
    upsert: vi.fn(),
  },
  canvasEdge: {
    findFirst: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
    upsert: vi.fn(),
    findMany: vi.fn(),
  },
  $transaction: vi.fn(),
}))

vi.mock('@/lib/api-auth', () => authMock)
vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))
vi.mock('@/lib/media/attach', () => ({
  attachMediaFieldsToProject: vi.fn(async (value: unknown) => value),
}))

describe('project canvas route scope', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.canvas.findFirst.mockResolvedValue({
      id: 'canvas-1',
      projectId: 'project-1',
      userId: 'user-1',
      title: 'Canvas',
      themeColor: null,
      viewport: null,
      visibility: 'PRIVATE',
      forkedFromId: null,
      createdAt: new Date('2026-06-14T00:00:00.000Z'),
      updatedAt: new Date('2026-06-14T00:00:00.000Z'),
    })
    prismaMock.project.findFirst.mockResolvedValue({
      id: 'project-1',
      userId: 'user-1',
      novelPromotionData: { episodes: [] },
    })
    prismaMock.canvasNode.findFirst.mockResolvedValue({
      id: 'node-1',
      canvasId: 'canvas-1',
    })
    prismaMock.canvasEdge.findFirst.mockResolvedValue({
      id: 'edge-1',
      canvasId: 'canvas-1',
    })
    prismaMock.canvasNode.findMany.mockResolvedValue([])
    prismaMock.canvasEdge.findMany.mockResolvedValue([])
    prismaMock.canvas.findUnique.mockResolvedValue({
      id: 'canvas-1',
      projectId: 'project-1',
      title: 'Canvas',
      themeColor: null,
      viewport: null,
      visibility: 'PRIVATE',
      forkedFromId: null,
      createdAt: new Date('2026-06-14T00:00:00.000Z'),
      updatedAt: new Date('2026-06-14T00:00:00.000Z'),
    })
    prismaMock.$transaction.mockImplementation(async (input: unknown) => {
      if (typeof input === 'function') {
        return await input(prismaMock)
      }
      return await Promise.all(input as Promise<unknown>[])
    })
  })

  it('requires the canvas lookup to include the current project id', async () => {
    prismaMock.canvas.findFirst.mockResolvedValueOnce(null)
    const { GET } = await import('@/app/api/projects/[projectId]/canvas/[canvasId]/route')

    const res = await GET(
      buildMockRequest({
        path: '/api/projects/project-1/canvas/canvas-other',
        method: 'GET',
      }),
      { params: Promise.resolve({ projectId: 'project-1', canvasId: 'canvas-other' }) },
    )

    expect(res.status).toBe(404)
    expect(prismaMock.canvas.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: 'canvas-other',
        projectId: 'project-1',
      },
    }))
    expect(prismaMock.canvasNode.findMany).not.toHaveBeenCalled()
    expect(prismaMock.canvasEdge.findMany).not.toHaveBeenCalled()
  })

  it('deletes nodes only after finding the node inside the current canvas', async () => {
    prismaMock.canvasNode.findFirst.mockResolvedValueOnce(null)
    const { DELETE } = await import('@/app/api/projects/[projectId]/canvas/[canvasId]/nodes/[nodeId]/route')

    const res = await DELETE(
      buildMockRequest({
        path: '/api/projects/project-1/canvas/canvas-1/nodes/node-other',
        method: 'DELETE',
      }),
      { params: Promise.resolve({ projectId: 'project-1', canvasId: 'canvas-1', nodeId: 'node-other' }) },
    )

    expect(res.status).toBe(404)
    expect(prismaMock.canvasNode.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'node-other',
        canvasId: 'canvas-1',
      },
      select: { id: true, canvasId: true },
    })
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it('deletes edges only after finding the edge inside the current canvas', async () => {
    prismaMock.canvasEdge.findFirst.mockResolvedValueOnce(null)
    const { DELETE } = await import('@/app/api/projects/[projectId]/canvas/[canvasId]/edges/[edgeId]/route')

    const res = await DELETE(
      buildMockRequest({
        path: '/api/projects/project-1/canvas/canvas-1/edges/edge-other',
        method: 'DELETE',
      }),
      { params: Promise.resolve({ projectId: 'project-1', canvasId: 'canvas-1', edgeId: 'edge-other' }) },
    )

    expect(res.status).toBe(404)
    expect(prismaMock.canvasEdge.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'edge-other',
        canvasId: 'canvas-1',
      },
      select: { id: true, canvasId: true },
    })
    expect(prismaMock.canvasEdge.delete).not.toHaveBeenCalled()
  })

  it('does not clear production canvas nodes when the authorized project row is missing', async () => {
    prismaMock.project.findFirst.mockResolvedValueOnce(null)
    const { POST } = await import('@/app/api/projects/[projectId]/canvas/[canvasId]/production-sync/route')

    const res = await POST(
      buildMockRequest({
        path: '/api/projects/project-1/canvas/canvas-1/production-sync',
        method: 'POST',
      }),
      { params: Promise.resolve({ projectId: 'project-1', canvasId: 'canvas-1' }) },
    )

    expect(res.status).toBe(404)
    expect(prismaMock.project.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: 'project-1',
        userId: 'user-1',
      },
    }))
    expect(prismaMock.canvasNode.deleteMany).not.toHaveBeenCalled()
    expect(prismaMock.canvasEdge.deleteMany).not.toHaveBeenCalled()
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })
})
