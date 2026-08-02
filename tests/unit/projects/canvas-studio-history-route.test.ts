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
  CANVAS_EDGE_ROLE_VALUES: ['INPUT_DEFAULT'],
  CANVAS_NODE_STATUS_VALUES: ['IDLE', 'RUNNING', 'SUCCEEDED', 'FAILED'],
  isAllowedNodeType: (value: string) => value === 'studio_3d',
  requireCanvasInProject: vi.fn(async () => ({
    id: 'canvas-1',
    projectId: 'project-1',
    revision: 9,
  })),
}))

const persistence = vi.hoisted(() => ({
  replaceCanvasDocumentInTransaction: vi.fn(async () => ({
    canvas: { id: 'canvas-1', revision: 10 },
    nodes: [],
    edges: [],
  })),
}))

const prisma = vi.hoisted(() => ({
  canvasSnapshot: {
    findFirst: vi.fn(),
  },
  $transaction: vi.fn(),
}))

vi.mock('@/lib/api-auth', () => auth)
vi.mock('@/lib/canvas/access', () => access)
vi.mock('@/lib/canvas/persistence', () => persistence)
vi.mock('@/lib/prisma', () => ({ prisma }))

import { POST } from '@/app/api/projects/[projectId]/canvas/[canvasId]/revisions/route'

describe('canvas history restores independent 3D studio documents', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prisma.$transaction.mockImplementation(async (callback: (tx: unknown) => unknown) => await callback({}))
    prisma.canvasSnapshot.findFirst.mockResolvedValue({
      revision: 4,
      document: {
        viewport: { x: 0, y: 0, zoom: 1 },
        nodes: [{
          id: 'studio-1',
          type: 'studio_3d',
          position: { x: 20, y: 30 },
          size: null,
          data: { title: '历史导演台' },
          status: 'IDLE',
          taskId: null,
          runId: null,
          mediaObjectId: null,
          parentNodeId: null,
        }],
        edges: [],
      },
      studioDocuments: [{
        nodeId: 'studio-1',
        revision: 7,
        document: { ...DEFAULT_STUDIO_SCENE, backgroundColor: '#334455' },
      }],
    })
  })

  it('loads the snapshot through the scoped canvas relation and restores its scene in the graph transaction', async () => {
    const response = await POST(buildMockRequest({
      path: '/api/projects/project-1/canvas/canvas-1/revisions',
      method: 'POST',
      body: { snapshotId: 'snapshot-4', expectedRevision: 9, clientId: 'tab-a' },
    }), { params: Promise.resolve({ projectId: 'project-1', canvasId: 'canvas-1' }) })

    expect(response.status).toBe(200)
    expect(prisma.canvasSnapshot.findFirst).toHaveBeenCalledWith({
      where: { id: 'snapshot-4', canvasId: 'canvas-1' },
      select: {
        revision: true,
        document: true,
        studioDocuments: {
          select: { nodeId: true, revision: true, document: true },
        },
      },
    })
    expect(persistence.replaceCanvasDocumentInTransaction).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      projectId: 'project-1',
      canvasId: 'canvas-1',
      userId: 'storyboard-user',
      templateOwnerId: 'workspace-owner',
      studioDocumentRestore: [expect.objectContaining({
        nodeId: 'studio-1',
        document: expect.objectContaining({ backgroundColor: '#334455' }),
      })],
      input: expect.objectContaining({
        expectedRevision: 9,
        changeSummary: '恢复到历史版本 4',
      }),
    }))
  })
})
