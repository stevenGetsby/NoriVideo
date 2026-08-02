import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_STUDIO_SCENE } from '@/features/canvas/studio-types'
import { buildMockRequest } from '../../helpers/request'

const auth = vi.hoisted(() => ({
  requireProjectAuthLight: vi.fn(async () => ({
    session: { user: { id: 'workspace-owner', actorId: 'storyboard-user' } },
    project: { id: 'project-1', userId: 'workspace-owner' },
  })),
  isErrorResponse: (value: unknown) => value instanceof Response,
}))

const access = vi.hoisted(() => ({
  requireCanvasInProject: vi.fn(async () => ({ id: 'canvas-1', projectId: 'project-1' })),
  requireStudioNodeInCanvas: vi.fn(async () => ({
    id: 'studio-1',
    canvasId: 'canvas-1',
    type: 'studio_3d',
    data: { studioScene: { version: 1, backgroundColor: '#020617' } },
  })),
}))

const prisma = vi.hoisted(() => ({
  canvasStudio3DDocument: {
    findFirst: vi.fn(),
    create: vi.fn(),
    updateMany: vi.fn(),
    findFirstOrThrow: vi.fn(),
  },
  $transaction: vi.fn(),
}))

vi.mock('@/lib/api-auth', () => auth)
vi.mock('@/lib/canvas/access', () => access)
vi.mock('@/lib/prisma', () => ({ prisma }))

describe('scoped canvas 3D studio document route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prisma.canvasStudio3DDocument.findFirst.mockResolvedValue(null)
    prisma.$transaction.mockImplementation(async (callback: (tx: typeof prisma) => unknown) => await callback(prisma))
  })

  it('loads a normalized legacy node seed only after project/canvas/node checks', async () => {
    const { GET } = await import('@/app/api/projects/[projectId]/canvas/[canvasId]/nodes/[nodeId]/studio-document/route')
    const response = await GET(
      buildMockRequest({
        path: '/api/projects/project-1/canvas/canvas-1/nodes/studio-1/studio-document',
        method: 'GET',
      }),
      { params: Promise.resolve({ projectId: 'project-1', canvasId: 'canvas-1', nodeId: 'studio-1' }) },
    )

    expect(response.status).toBe(200)
    expect(auth.requireProjectAuthLight).toHaveBeenCalledWith('project-1')
    expect(access.requireCanvasInProject).toHaveBeenCalledWith('canvas-1', 'project-1')
    expect(access.requireStudioNodeInCanvas).toHaveBeenCalledWith('studio-1', 'canvas-1')
    expect(prisma.canvasStudio3DDocument.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { projectId: 'project-1', canvasId: 'canvas-1', nodeId: 'studio-1' },
    }))
    await expect(response.json()).resolves.toMatchObject({
      studioDocument: {
        revision: 0,
        persisted: false,
        source: 'legacy-node',
        document: { version: 3, backgroundColor: '#020617' },
      },
    })
  })

  it('returns actualRevision on an optimistic write conflict without mutation', async () => {
    prisma.canvasStudio3DDocument.findFirst.mockResolvedValue({ id: 'document-1', revision: 9 })
    const { PUT } = await import('@/app/api/projects/[projectId]/canvas/[canvasId]/nodes/[nodeId]/studio-document/route')
    const response = await PUT(
      buildMockRequest({
        path: '/api/projects/project-1/canvas/canvas-1/nodes/studio-1/studio-document',
        method: 'PUT',
        body: { expectedRevision: 8, clientId: 'tab-a', document: DEFAULT_STUDIO_SCENE },
      }),
      { params: Promise.resolve({ projectId: 'project-1', canvasId: 'canvas-1', nodeId: 'studio-1' }) },
    )

    expect(response.status).toBe(409)
    expect(auth.requireProjectAuthLight).toHaveBeenCalledWith('project-1', ['canvasWrite'])
    await expect(response.json()).resolves.toMatchObject({
      error: {
        details: {
          reason: 'STUDIO_DOCUMENT_REVISION_CONFLICT',
          expectedRevision: 8,
          actualRevision: 9,
        },
      },
      actualRevision: 9,
    })
    expect(prisma.canvasStudio3DDocument.updateMany).not.toHaveBeenCalled()
  })

  it('creates the first independent document at revision one', async () => {
    prisma.canvasStudio3DDocument.create.mockResolvedValue({
      revision: 1,
      document: DEFAULT_STUDIO_SCENE,
      updatedAt: new Date('2026-07-17T15:00:00.000Z'),
    })
    const { PUT } = await import('@/app/api/projects/[projectId]/canvas/[canvasId]/nodes/[nodeId]/studio-document/route')
    const response = await PUT(
      buildMockRequest({
        path: '/api/projects/project-1/canvas/canvas-1/nodes/studio-1/studio-document',
        method: 'PUT',
        body: { expectedRevision: 0, clientId: 'tab-a', document: DEFAULT_STUDIO_SCENE },
      }),
      { params: Promise.resolve({ projectId: 'project-1', canvasId: 'canvas-1', nodeId: 'studio-1' }) },
    )

    expect(response.status).toBe(200)
    expect(prisma.canvasStudio3DDocument.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        projectId: 'project-1',
        canvasId: 'canvas-1',
        nodeId: 'studio-1',
        revision: 1,
        updatedBy: 'storyboard-user',
      }),
    }))
    await expect(response.json()).resolves.toMatchObject({
      studioDocument: { revision: 1, persisted: true },
    })
  })
})
