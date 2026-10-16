import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_CANVAS_DOCUMENT_BYTES } from '@/lib/canvas/document'
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
    findUniqueOrThrow: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
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
  canvasSnapshot: {
    create: vi.fn(),
    findMany: vi.fn(),
    deleteMany: vi.fn(),
  },
  canvasStudio3DDocument: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    createMany: vi.fn(),
    updateMany: vi.fn(),
  },
  canvasStudio3DDocumentSnapshot: {
    createMany: vi.fn(),
  },
  canvasWorkflowTemplate: {
    findFirst: vi.fn(),
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
      revision: 4,
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
    prismaMock.canvas.findUniqueOrThrow.mockResolvedValue({
      id: 'canvas-1',
      projectId: 'project-1',
      title: 'Canvas',
      themeColor: null,
      viewport: null,
      revision: 5,
      visibility: 'PRIVATE',
      forkedFromId: null,
      createdAt: new Date('2026-06-14T00:00:00.000Z'),
      updatedAt: new Date('2026-06-14T00:00:00.000Z'),
    })
    prismaMock.canvas.updateMany.mockResolvedValue({ count: 1 })
    prismaMock.canvasSnapshot.findMany.mockResolvedValue([])
    prismaMock.canvasSnapshot.create.mockResolvedValue({ id: 'snapshot-5' })
    prismaMock.canvasStudio3DDocument.findMany.mockResolvedValue([])
    prismaMock.canvasStudio3DDocumentSnapshot.createMany.mockResolvedValue({ count: 0 })
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

  it('rejects legacy incremental node deletion with a complete-document migration error', async () => {
    const { DELETE } = await import('@/app/api/projects/[projectId]/canvas/[canvasId]/nodes/[nodeId]/route')

    const res = await DELETE(
      buildMockRequest({
        path: '/api/projects/project-1/canvas/canvas-1/nodes/node-other',
        method: 'DELETE',
      }),
      { params: Promise.resolve({ projectId: 'project-1', canvasId: 'canvas-1', nodeId: 'node-other' }) },
    )

    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toMatchObject({
      error: {
        message: expect.stringContaining('完整文档保存接口'),
        details: {
          reason: 'CANVAS_INCREMENTAL_WRITE_DISABLED',
          replacement: '/api/projects/project-1/canvas/canvas-1/document',
          replacementMethod: 'PUT',
        },
      },
    })
    expect(prismaMock.canvasNode.findFirst).not.toHaveBeenCalled()
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it('rejects legacy incremental edge deletion with a complete-document migration error', async () => {
    const { DELETE } = await import('@/app/api/projects/[projectId]/canvas/[canvasId]/edges/[edgeId]/route')

    const res = await DELETE(
      buildMockRequest({
        path: '/api/projects/project-1/canvas/canvas-1/edges/edge-other',
        method: 'DELETE',
      }),
      { params: Promise.resolve({ projectId: 'project-1', canvasId: 'canvas-1', edgeId: 'edge-other' }) },
    )

    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toMatchObject({
      error: {
        message: expect.stringContaining('完整文档保存接口'),
        details: {
          reason: 'CANVAS_INCREMENTAL_WRITE_DISABLED',
          replacement: '/api/projects/project-1/canvas/canvas-1/document',
          replacementMethod: 'PUT',
        },
      },
    })
    expect(prismaMock.canvasEdge.findFirst).not.toHaveBeenCalled()
    expect(prismaMock.canvasEdge.delete).not.toHaveBeenCalled()
  })

  it('rejects legacy incremental node creation and patching without mutating graph rows', async () => {
    const { POST, PATCH } = await import('@/app/api/projects/[projectId]/canvas/[canvasId]/nodes/route')
    const context = { params: Promise.resolve({ projectId: 'project-1', canvasId: 'canvas-1' }) }

    const createResponse = await POST(
      buildMockRequest({
        path: '/api/projects/project-1/canvas/canvas-1/nodes',
        method: 'POST',
        body: { type: 'text', position: { x: 0, y: 0 } },
      }),
      context,
    )
    const patchResponse = await PATCH(
      buildMockRequest({
        path: '/api/projects/project-1/canvas/canvas-1/nodes',
        method: 'PATCH',
        body: { updates: [{ id: 'node-1', position: { x: 10, y: 20 } }] },
      }),
      context,
    )

    expect(createResponse.status).toBe(409)
    expect(patchResponse.status).toBe(409)
    await expect(createResponse.json()).resolves.toMatchObject({
      error: { details: { reason: 'CANVAS_INCREMENTAL_WRITE_DISABLED' } },
    })
    await expect(patchResponse.json()).resolves.toMatchObject({
      error: { details: { reason: 'CANVAS_INCREMENTAL_WRITE_DISABLED' } },
    })
    expect(prismaMock.canvasNode.findMany).not.toHaveBeenCalled()
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it('rejects legacy incremental edge creation without inspecting or mutating graph rows', async () => {
    const { POST } = await import('@/app/api/projects/[projectId]/canvas/[canvasId]/edges/route')
    const res = await POST(
      buildMockRequest({
        path: '/api/projects/project-1/canvas/canvas-1/edges',
        method: 'POST',
        body: { sourceNodeId: 'node-1', targetNodeId: 'node-2' },
      }),
      { params: Promise.resolve({ projectId: 'project-1', canvasId: 'canvas-1' }) },
    )

    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toMatchObject({
      error: {
        message: expect.stringContaining('完整文档保存接口'),
        details: { reason: 'CANVAS_INCREMENTAL_WRITE_DISABLED' },
      },
    })
    expect(prismaMock.canvasNode.findMany).not.toHaveBeenCalled()
    expect(prismaMock.canvasEdge.findFirst).not.toHaveBeenCalled()
  })

  it('returns the document byte budget in a unified validation error', async () => {
    const { PUT } = await import('@/app/api/projects/[projectId]/canvas/[canvasId]/document/route')
    const res = await PUT(
      buildMockRequest({
        path: '/api/projects/project-1/canvas/canvas-1/document',
        method: 'PUT',
        body: {
          expectedRevision: 4,
          clientId: 'tab-1',
          changeSummary: null,
          viewport: { x: 0, y: 0, zoom: 1 },
          nodes: [],
          edges: [],
          ignoredPadding: 'x'.repeat(MAX_CANVAS_DOCUMENT_BYTES),
        },
      }),
      { params: Promise.resolve({ projectId: 'project-1', canvasId: 'canvas-1' }) },
    )

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      error: {
        message: expect.stringContaining('16 MiB'),
        details: {
          reason: 'CANVAS_DOCUMENT_TOO_LARGE',
          maxBytes: MAX_CANVAS_DOCUMENT_BYTES,
        },
      },
    })
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it('does not clear production canvas nodes when the authorized project row is missing', async () => {
    prismaMock.project.findFirst.mockResolvedValueOnce(null)
    const { POST } = await import('@/app/api/projects/[projectId]/canvas/[canvasId]/production-sync/route')

    const res = await POST(
      buildMockRequest({
        path: '/api/projects/project-1/canvas/canvas-1/production-sync',
        method: 'POST',
        body: { expectedRevision: 4, clientId: 'tab-1' },
      }),
      { params: Promise.resolve({ projectId: 'project-1', canvasId: 'canvas-1' }) },
    )

    expect(res.status).toBe(404)
    expect(prismaMock.project.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: 'project-1',
        userId: 'user-1',
        deletedAt: null,
      },
    }))
    expect(prismaMock.canvasNode.deleteMany).not.toHaveBeenCalled()
    expect(prismaMock.canvasEdge.deleteMany).not.toHaveBeenCalled()
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it('cleans legacy unscoped production ids from the current canvas during sync', async () => {
    prismaMock.canvasNode.findMany
      .mockResolvedValueOnce([{ id: 'prod_episode_episode-1' }])
      .mockResolvedValueOnce([])
    const { POST } = await import('@/app/api/projects/[projectId]/canvas/[canvasId]/production-sync/route')

    const res = await POST(
      buildMockRequest({
        path: '/api/projects/project-1/canvas/canvas-1/production-sync',
        method: 'POST',
        body: { expectedRevision: 4, clientId: 'tab-1' },
      }),
      { params: Promise.resolve({ projectId: 'project-1', canvasId: 'canvas-1' }) },
    )

    expect(res.status).toBe(200)
    expect(prismaMock.canvasNode.deleteMany).toHaveBeenCalledWith({
      where: { canvasId: 'canvas-1', id: { in: ['prod_episode_episode-1'] } },
    })
    expect(prismaMock.canvas.updateMany).toHaveBeenCalledWith({
      where: { id: 'canvas-1', projectId: 'project-1', revision: 4 },
      data: { revision: { increment: 1 } },
    })
    expect(prismaMock.canvas.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      prismaMock.canvasNode.deleteMany.mock.invocationCallOrder[0],
    )
    expect(prismaMock.canvasSnapshot.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        canvasId: 'canvas-1',
        revision: 5,
        clientId: 'tab-1',
        changeSummary: '同步作品内容',
      }),
    }))
  })

  it('does not mutate production rows when the revision claim loses to another tab', async () => {
    prismaMock.canvas.updateMany.mockResolvedValueOnce({ count: 0 })
    const { POST } = await import('@/app/api/projects/[projectId]/canvas/[canvasId]/production-sync/route')

    const res = await POST(
      buildMockRequest({
        path: '/api/projects/project-1/canvas/canvas-1/production-sync',
        method: 'POST',
        body: { expectedRevision: 4, clientId: 'tab-1' },
      }),
      { params: Promise.resolve({ projectId: 'project-1', canvasId: 'canvas-1' }) },
    )

    expect(res.status).toBe(409)
    expect(prismaMock.canvasEdge.deleteMany).not.toHaveBeenCalled()
    expect(prismaMock.canvasNode.deleteMany).not.toHaveBeenCalled()
    expect(prismaMock.canvasNode.upsert).not.toHaveBeenCalled()
    expect(prismaMock.canvasSnapshot.create).not.toHaveBeenCalled()
  })
})
