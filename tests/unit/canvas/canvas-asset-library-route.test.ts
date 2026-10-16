import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../helpers/request'

const authMock = vi.hoisted(() => ({
  requireProjectAuthLight: vi.fn(async (projectId: string) => ({
    session: { user: { id: 'user-1', name: '资产师' } },
    project: { id: projectId, userId: 'user-1' },
  })),
  isErrorResponse: (value: unknown) => value instanceof Response,
}))

const scopeMock = vi.hoisted(() => ({
  requireCanvasInProject: vi.fn(async (canvasId: string, projectId: string) => ({ id: canvasId, projectId })),
}))

const prismaMock = vi.hoisted(() => ({
  canvasNode: { findMany: vi.fn() },
  frameosMaterial: { findFirst: vi.fn() },
}))

const materialMock = vi.hoisted(() => ({
  registerFrameosMaterial: vi.fn(async (input: Record<string, unknown>) => ({
    id: 'material-1',
    title: input.title,
  })),
}))

vi.mock('@/lib/api-auth', () => authMock)
vi.mock('@/lib/canvas/access', () => scopeMock)
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/frameos/material-service', () => materialMock)
vi.mock('@/lib/frameos/material-upload', () => ({ uploadFrameosMaterial: vi.fn() }))

const imageNode = {
  id: 'node-1',
  type: 'image',
  data: { title: '主角定妆照', contentUrl: 'images/frameos-material-user/scene.jpg', mediaType: 'image' },
}

async function post(body: unknown) {
  const { POST } = await import('@/app/api/projects/[projectId]/canvas/[canvasId]/materials/route')
  return await POST(buildMockRequest({
    path: '/api/projects/project-1/canvas/canvas-1/materials',
    method: 'POST',
    body,
  }), { params: Promise.resolve({ projectId: 'project-1', canvasId: 'canvas-1' }) })
}

describe('画布节点登记到资产库', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.canvasNode.findMany.mockResolvedValue([imageNode])
    prismaMock.frameosMaterial.findFirst.mockResolvedValue({ id: 'material-existing' })
    materialMock.registerFrameosMaterial.mockResolvedValue({ id: 'material-1', title: '主角定妆照' })
  })

  it('归类后以本地上传素材写入资产库', async () => {
    const response = await post({
      register: 'library',
      nodeIds: ['node-1'],
      title: '主角定妆照',
      assetCategory: 'location',
    })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      materialByNodeId: { 'node-1': 'material-1' },
      materials: [{ nodeId: 'node-1', materialId: 'material-1', title: '主角定妆照' }],
    })
    expect(materialMock.registerFrameosMaterial).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      projectId: 'project-1',
      title: '主角定妆照',
      type: 'image',
      source: 'upload',
      resultUrl: 'images/frameos-material-user/scene.jpg',
      metadata: expect.objectContaining({
        assetCategory: 'location',
        canvasId: 'canvas-1',
        canvasNodeId: 'node-1',
        uploadedFromCanvas: true,
      }),
    }))
  })

  it('归类非法时回退到普通素材，不写入错误分类', async () => {
    await post({ register: 'library', nodeIds: ['node-1'], title: '未命名', assetCategory: 'not-a-category' })
    expect(materialMock.registerFrameosMaterial).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ assetCategory: 'other' }),
    }))
  })

  it('资产库目前只接受图片节点', async () => {
    prismaMock.canvasNode.findMany.mockResolvedValue([
      { id: 'node-1', type: 'video', data: { title: '片段', videoUrl: 'video/clip.mp4', mediaType: 'video' } },
    ])
    const response = await post({ register: 'library', nodeIds: ['node-1'], assetCategory: 'prop' })
    expect(response.status).toBe(400)
    expect(materialMock.registerFrameosMaterial).not.toHaveBeenCalled()
  })

  it('原有引用登记仍复用已有素材、不改变来源', async () => {
    prismaMock.canvasNode.findMany.mockResolvedValue([
      { id: 'node-1', type: 'image', data: { title: '已有素材', materialId: 'material-existing' } },
    ])
    const response = await post({ nodeIds: ['node-1'] })
    await expect(response.json()).resolves.toMatchObject({ materialByNodeId: { 'node-1': 'material-existing' } })
    expect(materialMock.registerFrameosMaterial).not.toHaveBeenCalled()
  })

  it('失效节点整批拒绝，不先登记有效项', async () => {
    const response = await post({ nodeIds: ['node-1', 'deleted-node'] })
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'INVALID_PARAMS', details: { missingReferenceNodeIds: ['deleted-node'] } },
    })
    expect(materialMock.registerFrameosMaterial).not.toHaveBeenCalled()
  })

  it('已删除素材不能因为节点缓存了 materialId 就继续复用', async () => {
    prismaMock.canvasNode.findMany.mockResolvedValue([
      { ...imageNode, data: { ...imageNode.data, materialId: 'material-deleted' } },
    ])
    prismaMock.frameosMaterial.findFirst.mockResolvedValue(null)
    expect((await post({ nodeIds: ['node-1'] })).status).toBe(400)
    expect(materialMock.registerFrameosMaterial).not.toHaveBeenCalled()
  })

  it('超过登记上限要明确拒绝，不能截掉末尾引用', async () => {
    expect((await post({ nodeIds: Array.from({ length: 21 }, (_, i) => `node-${i}`) })).status).toBe(400)
    expect(prismaMock.canvasNode.findMany).not.toHaveBeenCalled()
  })
})
