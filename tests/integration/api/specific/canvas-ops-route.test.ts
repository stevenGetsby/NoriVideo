import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'
import { buildMockRequest } from '../../../helpers/request'

const authMock = vi.hoisted(() => ({
  requireProjectAuthLight: vi.fn(),
  isErrorResponse: (value: unknown) => value instanceof Response,
}))

const scopeMock = vi.hoisted(() => ({
  requireCanvasInProject: vi.fn(),
}))

const persistenceMock = vi.hoisted(() => ({
  applyCanvasOperationsInTransaction: vi.fn(),
}))

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => await callback({ transaction: true })),
}))

vi.mock('@/lib/api-auth', () => authMock)
vi.mock('@/lib/canvas/access', () => scopeMock)
vi.mock('@/lib/canvas/persistence', () => persistenceMock)
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

function request(expectedRevision = 7) {
  return buildMockRequest({
    path: '/api/projects/project-1/canvas/canvas-1/ops',
    method: 'POST',
    body: {
      expectedRevision,
      clientId: 'tab-1',
      changeSummary: '移动节点',
      ops: [{
        type: 'node.delete',
        id: 'node-1',
      }],
    },
  })
}

describe('canvas operation API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMock.requireProjectAuthLight.mockResolvedValue({
      session: { user: { id: 'user-1', actorId: 'actor-1' } },
      project: { id: 'project-1', userId: 'user-1' },
    })
    scopeMock.requireCanvasInProject.mockResolvedValue({ id: 'canvas-1', projectId: 'project-1', revision: 7 })
    persistenceMock.applyCanvasOperationsInTransaction.mockResolvedValue({
      canvas: { id: 'canvas-1', projectId: 'project-1', revision: 8 },
      nodes: [],
      edges: [],
    })
  })

  it('uses the independent canvas permission and submits one atomic transaction', async () => {
    const { POST } = await import('@/app/api/projects/[projectId]/canvas/[canvasId]/ops/route')
    const response = await POST(request(), {
      params: Promise.resolve({ projectId: 'project-1', canvasId: 'canvas-1' }),
    })

    expect(response.status).toBe(200)
    expect(authMock.requireProjectAuthLight).toHaveBeenCalledWith('project-1', ['canvasWrite'])
    expect(scopeMock.requireCanvasInProject).toHaveBeenCalledWith('canvas-1', 'project-1')
    expect(prismaMock.$transaction).toHaveBeenCalledOnce()
    expect(persistenceMock.applyCanvasOperationsInTransaction).toHaveBeenCalledWith(
      { transaction: true },
      expect.objectContaining({
        projectId: 'project-1',
        canvasId: 'canvas-1',
        userId: 'actor-1',
        input: expect.objectContaining({ expectedRevision: 7 }),
      }),
    )
  })

  it('returns a 409 with actualRevision before opening a stale transaction', async () => {
    const { POST } = await import('@/app/api/projects/[projectId]/canvas/[canvasId]/ops/route')
    const response = await POST(request(6), {
      params: Promise.resolve({ projectId: 'project-1', canvasId: 'canvas-1' }),
    })

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      actualRevision: 7,
      error: { details: { expectedRevision: 6, actualRevision: 7 } },
    })
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it('does not inspect the canvas when project write authorization is denied', async () => {
    authMock.requireProjectAuthLight.mockResolvedValueOnce(NextResponse.json({ error: 'forbidden' }, { status: 403 }))
    const { POST } = await import('@/app/api/projects/[projectId]/canvas/[canvasId]/ops/route')
    const response = await POST(request(), {
      params: Promise.resolve({ projectId: 'project-1', canvasId: 'canvas-1' }),
    })

    expect(response.status).toBe(403)
    expect(scopeMock.requireCanvasInProject).not.toHaveBeenCalled()
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })
})
