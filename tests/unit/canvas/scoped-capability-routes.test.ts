import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'
import { buildMockRequest } from '../../helpers/request'

const authMock = vi.hoisted(() => ({
  requireProjectAuthLight: vi.fn(async (projectId: string) => ({
    session: { user: { id: 'workspace-1', name: 'Storyboard Artist' } },
    project: { id: projectId, userId: 'workspace-1' },
  })),
  isErrorResponse: (value: unknown) => value instanceof Response,
}))

const scopeMock = vi.hoisted(() => ({
  requireCanvasInProject: vi.fn(async (canvasId: string, projectId: string) => ({ id: canvasId, projectId })),
}))

const capabilityMock = vi.hoisted(() => ({
  upload: vi.fn(async () => NextResponse.json({ success: true, material: { id: 'material-1' } })),
  generate: vi.fn(async (request: Request, context?: unknown) => {
    void request
    void context
    return NextResponse.json({ success: true, tasks: [{ taskId: 'task-1', assetId: 'asset-1' }] })
  }),
}))

vi.mock('@/lib/api-auth', () => authMock)
vi.mock('@/lib/canvas/access', () => scopeMock)
vi.mock('@/lib/frameos/material-upload', () => ({
  uploadFrameosMaterial: capabilityMock.upload,
}))
vi.mock('@/app/api/frameos/toolbox/generate/route', () => ({
  POST: capabilityMock.generate,
}))

describe('canvas-scoped upload and generation routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('delegates uploads only after project and canvas authorization', async () => {
    const { POST } = await import('@/app/api/projects/[projectId]/canvas/[canvasId]/materials/route')
    const request = buildMockRequest({
      path: '/api/projects/project-1/canvas/canvas-1/materials',
      method: 'POST',
    })
    const response = await POST(request, {
      params: Promise.resolve({ projectId: 'project-1', canvasId: 'canvas-1' }),
    })

    expect(response.status).toBe(200)
    expect(authMock.requireProjectAuthLight).toHaveBeenCalledWith('project-1', ['canvasWrite'])
    expect(scopeMock.requireCanvasInProject).toHaveBeenCalledWith('canvas-1', 'project-1')
    expect(capabilityMock.upload).toHaveBeenCalledWith(
      request,
      expect.objectContaining({ user: expect.objectContaining({ id: 'workspace-1' }) }),
      expect.objectContaining({ expectedProjectId: 'project-1', projectAccessVerified: true }),
    )
  })

  it('rejects a generation payload for a different project', async () => {
    const { POST } = await import('@/app/api/projects/[projectId]/canvas/[canvasId]/generate/route')
    const response = await POST(buildMockRequest({
      path: '/api/projects/project-1/canvas/canvas-1/generate',
      method: 'POST',
      body: { projectId: 'project-other', type: 'image' },
    }), {
      params: Promise.resolve({ projectId: 'project-1', canvasId: 'canvas-1' }),
    })

    expect(response.status).toBe(400)
    expect(capabilityMock.generate).not.toHaveBeenCalled()
  })

  it('delegates generation with the authorized canvas context intact', async () => {
    const { POST } = await import('@/app/api/projects/[projectId]/canvas/[canvasId]/generate/route')
    const request = buildMockRequest({
      path: '/api/projects/project-1/canvas/canvas-1/generate',
      method: 'POST',
      body: { projectId: 'project-1', type: 'image' },
    })
    const response = await POST(request, {
      params: Promise.resolve({ projectId: 'project-1', canvasId: 'canvas-1' }),
    })

    expect(response.status).toBe(200)
    expect(scopeMock.requireCanvasInProject).toHaveBeenCalledWith('canvas-1', 'project-1')
    expect(capabilityMock.generate).toHaveBeenCalledOnce()
    const delegated = capabilityMock.generate.mock.calls[0]?.[0] as Request
    expect(delegated).not.toBe(request)
    expect(await delegated.clone().json()).toMatchObject({
      projectId: 'project-1',
      type: 'image',
      options: {
        aspectRatio: '16:9',
        resolution: '2K',
        quality: 'high',
      },
    })
  })

  it('submits panorama images at 21:9 and upgrades legacy 2:1 requests', async () => {
    const { POST } = await import('@/app/api/projects/[projectId]/canvas/[canvasId]/generate/route')
    const response = await POST(buildMockRequest({
      path: '/api/projects/project-1/canvas/canvas-1/generate',
      method: 'POST',
      body: {
        projectId: 'project-1',
        type: 'image',
        options: { aspectRatio: '2:1', resolution: '2K', quality: 'high' },
      },
    }), {
      params: Promise.resolve({ projectId: 'project-1', canvasId: 'canvas-1' }),
    })

    expect(response.status).toBe(200)
    const delegated = capabilityMock.generate.mock.calls[0]?.[0] as Request
    expect(await delegated.clone().json()).toMatchObject({
      options: { aspectRatio: '21:9', resolution: '2K', quality: 'high' },
    })
  })

  it('normalizes all visible video modes, frame rate, and official 4k casing', async () => {
    const { POST } = await import('@/app/api/projects/[projectId]/canvas/[canvasId]/generate/route')
    const response = await POST(buildMockRequest({
      path: '/api/projects/project-1/canvas/canvas-1/generate',
      method: 'POST',
      body: {
        projectId: 'project-1',
        type: 'video',
        inputMode: 'image',
        options: { aspectRatio: '21:9', resolution: '4k', duration: 15, fps: 24, generateAudio: true },
      },
    }), {
      params: Promise.resolve({ projectId: 'project-1', canvasId: 'canvas-1' }),
    })

    expect(response.status).toBe(200)
    const delegated = capabilityMock.generate.mock.calls[0]?.[0] as Request
    expect(await delegated.clone().json()).toMatchObject({
      inputMode: 'image',
      options: {
        aspectRatio: '21:9',
        resolution: '4k',
        duration: 15,
        fps: 24,
        generateAudio: true,
      },
    })
  })

  it('rejects out-of-contract video options before delegating to a provider task', async () => {
    const { POST } = await import('@/app/api/projects/[projectId]/canvas/[canvasId]/generate/route')
    const response = await POST(buildMockRequest({
      path: '/api/projects/project-1/canvas/canvas-1/generate',
      method: 'POST',
      body: {
        projectId: 'project-1',
        type: 'video',
        inputMode: 'text',
        options: { aspectRatio: '7:5', resolution: '720p', duration: 5 },
      },
    }), {
      params: Promise.resolve({ projectId: 'project-1', canvasId: 'canvas-1' }),
    })

    expect(response.status).toBe(400)
    expect(capabilityMock.generate).not.toHaveBeenCalled()
  })
})
