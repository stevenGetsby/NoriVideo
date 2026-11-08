import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const authMock = vi.hoisted(() => ({
  requireUserAuth: vi.fn(),
  isErrorResponse: (value: unknown) => value instanceof Response,
}))
const prismaMock = vi.hoisted(() => ({
  frameosScript: {
    findFirst: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}))

vi.mock('@/lib/api-auth', () => authMock)
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

const session = { user: { id: 'user-1', actorId: 'actor-1' } }

function storedScript(overrides?: Record<string, unknown>) {
  return {
    id: 'vr_draft',
    title: '改编第一集',
    content: '第1集\n场景：目标场景',
    status: 'draft',
    sections: {
      version: 1,
      kind: 'video-repaint',
      episodes: [{ id: 'ep-1', title: '第 1 集', body: '第1集\n场景：目标场景' }],
      sourceScript: '第1集\n场景：源场景',
      sourceStoryboard: '',
      adaptationBrief: '',
      resultMode: 'llm',
      model: '',
      sourceFileName: 'sample.mp4',
    },
    createdAt: new Date('2026-11-01T00:00:00.000Z'),
    updatedAt: new Date('2026-11-01T00:00:00.000Z'),
    userId: 'actor-1',
    ...overrides,
  }
}

function params() {
  return { params: Promise.resolve({ scriptId: 'vr_draft' }) }
}

function request(method: string, payload?: unknown) {
  return new NextRequest('http://localhost/api/video-repaint/scripts/vr_draft', {
    method,
    ...(payload === undefined ? {} : {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  })
}

describe('/api/video-repaint/scripts/[scriptId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMock.requireUserAuth.mockResolvedValue({ session })
  })

  it('requires authentication and scopes reads to the acting account', async () => {
    authMock.requireUserAuth.mockResolvedValueOnce(NextResponse.json({ success: false }, { status: 401 }))
    const { GET } = await import('@/app/api/video-repaint/scripts/[scriptId]/route')
    const unauthorized = await GET(request('GET') as never, params())
    expect(unauthorized.status).toBe(401)
    expect(prismaMock.frameosScript.findFirst).not.toHaveBeenCalled()

    prismaMock.frameosScript.findFirst.mockResolvedValue(storedScript())
    const response = await GET(request('GET') as never, params())
    const payload = await response.json()

    expect(prismaMock.frameosScript.findFirst).toHaveBeenCalledWith({ where: { id: 'vr_draft', userId: 'actor-1' } })
    expect(response.status).toBe(200)
    expect(payload.script.id).toBe('vr_draft')
  })

  it('hides scripts owned by another account from read, update, and delete', async () => {
    prismaMock.frameosScript.findFirst.mockResolvedValue(null)
    const { GET, PATCH, DELETE } = await import('@/app/api/video-repaint/scripts/[scriptId]/route')

    for (const response of [
      await GET(request('GET') as never, params()),
      await PATCH(request('PATCH', { title: '劫持' }) as never, params()),
      await DELETE(request('DELETE') as never, params()),
    ]) {
      expect(response.status).toBe(404)
    }
    expect(prismaMock.frameosScript.update).not.toHaveBeenCalled()
    expect(prismaMock.frameosScript.delete).not.toHaveBeenCalled()
  })

  it('rejects too many episodes or an oversized total body before writing', async () => {
    prismaMock.frameosScript.findFirst.mockResolvedValue(storedScript())
    const { PATCH } = await import('@/app/api/video-repaint/scripts/[scriptId]/route')

    const tooMany = Array.from({ length: 201 }, (_, index) => ({ id: `ep-${index}`, title: `第 ${index + 1} 集`, body: '正文' }))
    const response = await PATCH(request('PATCH', { episodes: tooMany }) as never, params())
    expect(response.status).toBe(400)
    expect((await response.json()).error.code).toBe('INVALID_PARAMS')

    const huge = Array.from({ length: 6 }, (_, index) => ({ id: `ep-${index}`, title: `第 ${index + 1} 集`, body: 'x'.repeat(400_000) }))
    const oversized = await PATCH(request('PATCH', { episodes: huge }) as never, params())
    expect(oversized.status).toBe(400)
    expect((await oversized.json()).error.code).toBe('INVALID_PARAMS')

    expect(prismaMock.frameosScript.update).not.toHaveBeenCalled()
  })

  it('updates owned episodes and status with bounded fields', async () => {
    prismaMock.frameosScript.findFirst.mockResolvedValue(storedScript())
    prismaMock.frameosScript.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
      storedScript({ ...data, updatedAt: new Date() }))
    const { PATCH } = await import('@/app/api/video-repaint/scripts/[scriptId]/route')
    const response = await PATCH(request('PATCH', {
      title: '  新标题  ',
      status: 'available',
      episodes: [{ id: 'ep-1', title: '第一集', body: '新的正文' }],
    }) as never, params())
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(prismaMock.frameosScript.update).toHaveBeenCalledWith({
      where: { id: 'vr_draft' },
      data: expect.objectContaining({
        title: '新标题',
        status: 'available',
        content: '新的正文',
      }),
    })
    expect(payload.script.title).toBe('新标题')
    expect(payload.script.status).toBe('available')
  })

  it('deletes only the row resolved for the acting account', async () => {
    prismaMock.frameosScript.findFirst.mockResolvedValue(storedScript())
    prismaMock.frameosScript.delete.mockResolvedValue(storedScript())
    const { DELETE } = await import('@/app/api/video-repaint/scripts/[scriptId]/route')
    const response = await DELETE(request('DELETE') as never, params())

    expect(response.status).toBe(200)
    expect(prismaMock.frameosScript.delete).toHaveBeenCalledWith({ where: { id: 'vr_draft' } })
  })
})
