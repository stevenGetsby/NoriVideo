import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiFetchMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api-fetch', () => ({
  apiFetch: apiFetchMock,
}))

import { canvasApi, CanvasRevisionConflictError } from '@/features/canvas/api/client'

describe('canvas API client errors', () => {
  beforeEach(() => {
    apiFetchMock.mockReset()
  })

  it('surfaces the message from the unified nested error object', async () => {
    apiFetchMock.mockResolvedValue(new Response(JSON.stringify({
      success: false,
      message: 'flattened fallback',
      error: {
        code: 'CONFLICT',
        message: '画布版本已冲突，请刷新后重试。',
      },
    }), {
      status: 409,
      headers: { 'Content-Type': 'application/json' },
    }))

    await expect(canvasApi.list('project-1')).rejects.toThrow('画布版本已冲突，请刷新后重试。')
  })

  it('uses the unified nested message for revision conflicts', async () => {
    apiFetchMock.mockResolvedValue(new Response(JSON.stringify({
      success: false,
      error: {
        code: 'CONFLICT',
        message: '服务端画布版本已经变化。',
      },
    }), {
      status: 409,
      headers: { 'Content-Type': 'application/json' },
    }))

    const save = canvasApi.saveDocument('project-1', 'canvas-1', {
      expectedRevision: 1,
      clientId: 'tab-1',
      changeSummary: null,
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [],
      edges: [],
    })
    await expect(save).rejects.toMatchObject({
      name: 'CanvasRevisionConflictError',
      message: '服务端画布版本已经变化。',
      status: 409,
    } satisfies Partial<CanvasRevisionConflictError>)
  })

  it('posts compressed operations and exposes the conflicting server revision', async () => {
    apiFetchMock.mockResolvedValue(new Response(JSON.stringify({
      success: false,
      error: {
        code: 'CONFLICT',
        message: '服务端版本已变化。',
        details: { actualRevision: 12 },
      },
    }), {
      status: 409,
      headers: { 'Content-Type': 'application/json' },
    }))

    const save = canvasApi.saveOperations('project-1', 'canvas-1', {
      expectedRevision: 11,
      clientId: 'tab-1',
      changeSummary: '移动节点',
      ops: [{ type: 'node.delete', id: 'node-1' }],
    })
    await expect(save).rejects.toMatchObject({
      name: 'CanvasRevisionConflictError',
      actualRevision: 12,
    })
    expect(apiFetchMock).toHaveBeenCalledWith('/api/projects/project-1/canvas/canvas-1/ops', expect.objectContaining({
      method: 'POST',
    }))
  })
})
