import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../helpers/request'
import { DEFAULT_STUDIO_SCENE } from '@/features/canvas/studio-types'

const authMock = vi.hoisted(() => ({
  requireProjectAuthLight: vi.fn(async (projectId: string) => ({
    session: { user: { id: 'user-1' } },
    project: { id: projectId, userId: 'user-1' },
  })),
  isErrorResponse: (value: unknown) => value instanceof Response,
}))

const prismaMock = vi.hoisted(() => ({
  canvasWorkflowTemplate: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  canvasWorkflowTemplateStudio3DDocument: {
    createMany: vi.fn(),
  },
  canvas: {
    findFirst: vi.fn(),
  },
  canvasNode: {
    findFirst: vi.fn(),
  },
  canvasStudio3DDocument: {
    findFirst: vi.fn(),
  },
  $transaction: vi.fn(),
}))

vi.mock('@/lib/api-auth', () => authMock)
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

const node = {
  id: 'node-1',
  type: 'text',
  position: { x: 0, y: 0 },
  data: { title: 'Text', text: 'hello' },
}

describe('canvas workflow template routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.canvasWorkflowTemplate.findMany.mockResolvedValue([])
    prismaMock.canvasWorkflowTemplate.findFirst.mockResolvedValue({ id: 'template-1', projectId: 'project-1', userId: 'user-1' })
    prismaMock.canvasWorkflowTemplate.create.mockImplementation(async ({ data }) => ({ id: 'template-1', ...data }))
    prismaMock.canvasWorkflowTemplate.update.mockImplementation(async ({ data }) => ({ id: 'template-1', ...data }))
    prismaMock.canvasWorkflowTemplate.delete.mockResolvedValue({ id: 'template-1' })
    prismaMock.canvasWorkflowTemplateStudio3DDocument.createMany.mockResolvedValue({ count: 0 })
    prismaMock.$transaction.mockImplementation(async (callback: (tx: typeof prismaMock) => unknown) => await callback(prismaMock))
  })

  it('scopes template listing to the authorized user and project', async () => {
    const { GET } = await import('@/app/api/projects/[projectId]/canvas/templates/route')
    const response = await GET(buildMockRequest({ path: '/api/projects/project-1/canvas/templates', method: 'GET' }), { params: Promise.resolve({ projectId: 'project-1' }) })
    expect(response.status).toBe(200)
    expect(prismaMock.canvasWorkflowTemplate.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { projectId: 'project-1', userId: 'user-1' } }))
  })

  it('persists a bounded workflow document', async () => {
    const { POST } = await import('@/app/api/projects/[projectId]/canvas/templates/route')
    const response = await POST(buildMockRequest({
      path: '/api/projects/project-1/canvas/templates',
      method: 'POST',
      body: { name: ' Story workflow ', document: { nodes: [node], edges: [] } },
    }), { params: Promise.resolve({ projectId: 'project-1' }) })
    expect(response.status).toBe(201)
    expect(prismaMock.canvasWorkflowTemplate.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ projectId: 'project-1', userId: 'user-1', name: 'Story workflow', nodes: [node], edges: [] }),
    })
  })

  it('rejects empty workflow documents', async () => {
    const { POST } = await import('@/app/api/projects/[projectId]/canvas/templates/route')
    const response = await POST(buildMockRequest({
      path: '/api/projects/project-1/canvas/templates',
      method: 'POST',
      body: { name: 'Empty', document: { nodes: [], edges: [] } },
    }), { params: Promise.resolve({ projectId: 'project-1' }) })
    expect(response.status).toBe(400)
    expect(prismaMock.canvasWorkflowTemplate.create).not.toHaveBeenCalled()
  })

  it('checks template ownership before deleting', async () => {
    prismaMock.canvasWorkflowTemplate.findFirst.mockResolvedValueOnce(null)
    const { DELETE } = await import('@/app/api/projects/[projectId]/canvas/templates/[templateId]/route')
    const response = await DELETE(buildMockRequest({ path: '/api/projects/project-1/canvas/templates/template-other', method: 'DELETE' }), { params: Promise.resolve({ projectId: 'project-1', templateId: 'template-other' }) })
    expect(response.status).toBe(404)
    expect(prismaMock.canvasWorkflowTemplate.findFirst).toHaveBeenCalledWith({ where: { id: 'template-other', projectId: 'project-1', userId: 'user-1' } })
    expect(prismaMock.canvasWorkflowTemplate.delete).not.toHaveBeenCalled()
  })

  it('stores a self-contained studio scene and exposes a template-scoped copy source', async () => {
    const studioNode = {
      id: 'studio-source',
      type: 'studio_3d',
      position: { x: 0, y: 0 },
      data: {
        title: '3D 导演台',
        __studioDocumentSource: {
          kind: 'canvas-node',
          projectId: 'project-1',
          canvasId: 'canvas-1',
          nodeId: 'studio-source',
        },
      },
    }
    prismaMock.canvas.findFirst.mockResolvedValueOnce({ id: 'canvas-1' })
    prismaMock.canvasNode.findFirst.mockResolvedValueOnce({ id: 'studio-source', data: studioNode.data })
    prismaMock.canvasStudio3DDocument.findFirst.mockResolvedValueOnce({
      revision: 6,
      document: { ...DEFAULT_STUDIO_SCENE, backgroundColor: '#112233' },
    })
    const { POST, GET } = await import('@/app/api/projects/[projectId]/canvas/templates/route')
    const createResponse = await POST(buildMockRequest({
      path: '/api/projects/project-1/canvas/templates',
      method: 'POST',
      body: { name: '导演台模板', document: { nodes: [studioNode], edges: [] } },
    }), { params: Promise.resolve({ projectId: 'project-1' }) })

    expect(createResponse.status).toBe(201)
    expect(prismaMock.canvasWorkflowTemplateStudio3DDocument.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        templateId: 'template-1',
        sourceNodeId: 'studio-source',
        sourceRevision: 6,
        document: expect.objectContaining({ backgroundColor: '#112233' }),
      })],
    })

    prismaMock.canvasWorkflowTemplate.findMany.mockResolvedValueOnce([{
      id: 'template-1',
      projectId: 'project-1',
      userId: 'user-1',
      name: '导演台模板',
      nodes: [studioNode],
      edges: [],
      studioDocuments: [{ sourceNodeId: 'studio-source' }],
    }])
    const listResponse = await GET(
      buildMockRequest({ path: '/api/projects/project-1/canvas/templates', method: 'GET' }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )
    await expect(listResponse.json()).resolves.toMatchObject({
      templates: [{
        id: 'template-1',
        nodes: [{
          id: 'studio-source',
          data: {
            __studioDocumentSource: {
              kind: 'workflow-template',
              templateId: 'template-1',
              nodeId: 'studio-source',
            },
          },
        }],
      }],
    })
  })

  it('rejects a forged cross-project studio source without probing its canvas', async () => {
    const { POST } = await import('@/app/api/projects/[projectId]/canvas/templates/route')
    const response = await POST(buildMockRequest({
      path: '/api/projects/project-1/canvas/templates',
      method: 'POST',
      body: {
        name: '越权模板',
        document: {
          nodes: [{
            id: 'studio-other',
            type: 'studio_3d',
            position: { x: 0, y: 0 },
            data: {
              __studioDocumentSource: {
                kind: 'canvas-node',
                projectId: 'project-other',
                canvasId: 'canvas-other',
                nodeId: 'studio-other',
              },
            },
          }],
          edges: [],
        },
      },
    }), { params: Promise.resolve({ projectId: 'project-1' }) })

    expect(response.status).toBe(400)
    expect(prismaMock.canvas.findFirst).not.toHaveBeenCalled()
    expect(prismaMock.canvasStudio3DDocument.findFirst).not.toHaveBeenCalled()
    expect(prismaMock.canvasWorkflowTemplateStudio3DDocument.createMany).not.toHaveBeenCalled()
  })
})
