import { describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../helpers/request'

const auth = vi.hoisted(() => ({
  requireProjectAuthLight: vi.fn(async () => ({
    session: { user: { id: 'storyboard-user', name: '分镜师' } },
    project: { id: 'project-1', userId: 'manager-user' },
  })),
  isErrorResponse: (value: unknown) => value instanceof Response,
}))
const requireCanvasInProject = vi.hoisted(() => vi.fn(async () => ({ id: 'canvas-1' })))
const uploadFrameosMaterial = vi.hoisted(() => vi.fn(async () => Response.json({ success: true })))
const registerFrameosMaterial = vi.hoisted(() => vi.fn(async () => ({ id: 'material-from-url' })))
const prismaMock = vi.hoisted(() => ({
  canvasNode: {
    findMany: vi.fn(async () => [{
      id: 'node-url',
      type: 'video',
      data: { title: '外部视频', videoUrl: 'https://cdn.example.com/external.mp4' },
    }]),
  },
  frameosMaterial: {
    findFirst: vi.fn(async () => ({ id: 'material-1' })),
    update: vi.fn(async () => ({ id: 'material-1', isFavorited: true })),
  },
}))

vi.mock('@/lib/api-auth', () => auth)
vi.mock('@/lib/canvas/access', () => ({ requireCanvasInProject }))
vi.mock('@/lib/frameos/material-upload', () => ({ uploadFrameosMaterial }))
vi.mock('@/lib/frameos/material-service', () => ({ registerFrameosMaterial }))
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

import { PATCH, POST } from '@/app/api/projects/[projectId]/canvas/[canvasId]/materials/route'

describe('3D studio canvas screenshot upload route', () => {
  it('reuses verified canvas access for every creative-tool user', async () => {
    const request = buildMockRequest({
      path: '/api/projects/project-1/canvas/canvas-1/materials',
      method: 'POST',
    })
    const response = await POST(request, {
      params: Promise.resolve({ projectId: 'project-1', canvasId: 'canvas-1' }),
    })

    expect(response.status).toBe(200)
    expect(auth.requireProjectAuthLight).toHaveBeenCalledWith('project-1', ['canvasWrite'])
    expect(requireCanvasInProject).toHaveBeenCalledWith('canvas-1', 'project-1')
    expect(uploadFrameosMaterial).toHaveBeenCalledWith(
      request,
      expect.objectContaining({ user: expect.objectContaining({ id: 'storyboard-user' }) }),
      { expectedProjectId: 'project-1', projectAccessVerified: true },
    )
  })

  it('bookmarks only a material visible to the verified canvas project', async () => {
    const response = await PATCH(buildMockRequest({
      path: '/api/projects/project-1/canvas/canvas-1/materials',
      method: 'PATCH',
      body: { materialId: 'material-1', isFavorited: true },
    }), {
      params: Promise.resolve({ projectId: 'project-1', canvasId: 'canvas-1' }),
    })

    expect(response.status).toBe(200)
    expect(prismaMock.frameosMaterial.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'material-1',
        userId: 'storyboard-user',
        deletedAt: null,
        projectId: { in: ['project-1', 'global', 'global-asset-hub'] },
      },
      select: { id: true },
    })
    expect(prismaMock.frameosMaterial.update).toHaveBeenCalledWith({
      where: { id: 'material-1' },
      data: { isFavorited: true },
      select: { id: true, isFavorited: true },
    })
  })

  it('promotes a legacy URL-backed video node into a durable project material before generation', async () => {
    const response = await POST(buildMockRequest({
      path: '/api/projects/project-1/canvas/canvas-1/materials',
      method: 'POST',
      body: { nodeIds: ['node-url'] },
    }), {
      params: Promise.resolve({ projectId: 'project-1', canvasId: 'canvas-1' }),
    })

    expect(response.status).toBe(200)
    expect(registerFrameosMaterial).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'storyboard-user',
      projectId: 'project-1',
      title: '外部视频',
      type: 'video',
      resultUrl: 'https://cdn.example.com/external.mp4',
      source: 'creative',
    }))
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      materialByNodeId: { 'node-url': 'material-from-url' },
    })
  })
})
