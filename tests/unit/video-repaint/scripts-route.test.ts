import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const authMock = vi.hoisted(() => ({
  requireUserAuth: vi.fn(),
  isErrorResponse: (value: unknown) => value instanceof Response,
}))
const prismaMock = vi.hoisted(() => ({
  frameosScript: {
    findUnique: vi.fn(),
    findMany: vi.fn(async (): Promise<unknown[]> => []),
    create: vi.fn(),
  },
}))

vi.mock('@/lib/api-auth', () => authMock)
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

const session = { user: { id: 'user-1', actorId: 'actor-1' } }

function storedScript(overrides?: Record<string, unknown>) {
  return {
    id: 'vr_existing',
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
      model: 'nori::nori-gpt',
      sourceFileName: '',
    },
    createdAt: new Date('2026-11-01T00:00:00.000Z'),
    updatedAt: new Date('2026-11-01T00:00:00.000Z'),
    userId: 'actor-1',
    ...overrides,
  }
}

function postRequest(payload: unknown) {
  return new NextRequest('http://localhost/api/video-repaint/scripts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

function validPayload(overrides?: Record<string, unknown>) {
  return {
    title: '改编第一集',
    sourceScript: '第1集\n场景：源场景',
    targetScript: '第1集\n场景：目标场景',
    sourceStoryboard: '第1集 · 源分镜',
    adaptationBrief: '改为北美语境',
    resultMode: 'llm',
    clientRequestId: 'client-request-1',
    sourceAnalysis: { adaptation_contract: { story_invariants: [] } },
    ...overrides,
  }
}

describe('/api/video-repaint/scripts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMock.requireUserAuth.mockResolvedValue({ session })
    prismaMock.frameosScript.findUnique.mockResolvedValue(null)
    prismaMock.frameosScript.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
      storedScript({ ...data, createdAt: new Date(), updatedAt: new Date() }))
  })

  it('requires an authenticated account before reading or writing drafts', async () => {
    authMock.requireUserAuth.mockResolvedValueOnce(NextResponse.json({ success: false }, { status: 401 }))
    const { POST } = await import('@/app/api/video-repaint/scripts/route')
    const response = await POST(postRequest(validPayload()) as never, { params: Promise.resolve({}) })

    expect(response.status).toBe(401)
    expect(prismaMock.frameosScript.findUnique).not.toHaveBeenCalled()
    expect(prismaMock.frameosScript.create).not.toHaveBeenCalled()
  })

  it('creates a draft owned by the acting account with a deterministic retry id', async () => {
    const { POST } = await import('@/app/api/video-repaint/scripts/route')
    const response = await POST(postRequest(validPayload()) as never, { params: Promise.resolve({}) })
    const payload = await response.json()

    expect(response.status).toBe(201)
    expect(prismaMock.frameosScript.findUnique).toHaveBeenCalledWith({
      where: { id: expect.stringMatching(/^vr_[a-f0-9]{32}$/) },
    })
    expect(prismaMock.frameosScript.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'actor-1',
        title: '改编第一集',
        content: '第1集\n场景：目标场景',
        status: 'draft',
        id: expect.stringMatching(/^vr_[a-f0-9]{32}$/),
      }),
    })
    expect(payload.script).toEqual(expect.objectContaining({
      title: '改编第一集',
      type: '视频转绘',
      status: 'draft',
    }))
  })

  it('returns the existing draft instead of creating a duplicate on retry', async () => {
    prismaMock.frameosScript.findUnique.mockResolvedValue(storedScript())
    const { POST } = await import('@/app/api/video-repaint/scripts/route')
    const response = await POST(postRequest(validPayload()) as never, { params: Promise.resolve({}) })
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.idempotent).toBe(true)
    expect(payload.script.id).toBe('vr_existing')
    expect(prismaMock.frameosScript.create).not.toHaveBeenCalled()
  })

  it('rejects a replayed request id owned by another account', async () => {
    prismaMock.frameosScript.findUnique.mockResolvedValue(storedScript({ userId: 'actor-2' }))
    const { POST } = await import('@/app/api/video-repaint/scripts/route')
    const response = await POST(postRequest(validPayload()) as never, { params: Promise.resolve({}) })

    expect(response.status).toBe(409)
    expect((await response.json()).error.code).toBe('CONFLICT')
    expect(prismaMock.frameosScript.create).not.toHaveBeenCalled()
  })

  it('recovers a concurrent duplicate create through the unique constraint', async () => {
    prismaMock.frameosScript.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(storedScript())
    prismaMock.frameosScript.create.mockRejectedValueOnce(Object.assign(new Error('duplicate'), { code: 'P2002' }))
    const { POST } = await import('@/app/api/video-repaint/scripts/route')
    const response = await POST(postRequest(validPayload()) as never, { params: Promise.resolve({}) })
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.idempotent).toBe(true)
    expect(payload.script.id).toBe('vr_existing')
  })

  it('validates required fields, sizes, and request ids before touching the database', async () => {
    const { POST } = await import('@/app/api/video-repaint/scripts/route')
    for (const payload of [
      validPayload({ title: '   ' }),
      validPayload({ targetScript: '' }),
      validPayload({ targetScript: 'x'.repeat(400_001) }),
      validPayload({ clientRequestId: 'x'.repeat(201) }),
      validPayload({ sourceAnalysis: { big: 'x'.repeat(2 * 1024 * 1024) } }),
    ]) {
      const response = await POST(postRequest(payload) as never, { params: Promise.resolve({}) })
      expect(response.status).toBe(400)
      expect((await response.json()).error.code).toBe('INVALID_PARAMS')
    }
    expect(prismaMock.frameosScript.findUnique).not.toHaveBeenCalled()
    expect(prismaMock.frameosScript.create).not.toHaveBeenCalled()
  })

  it('lists only the acting account drafts', async () => {
    prismaMock.frameosScript.findMany.mockResolvedValue([storedScript()])
    const { GET } = await import('@/app/api/video-repaint/scripts/route')
    const response = await GET(new NextRequest('http://localhost/api/video-repaint/scripts') as never, { params: Promise.resolve({}) })
    const payload = await response.json()

    expect(prismaMock.frameosScript.findMany).toHaveBeenCalledWith({
      where: { userId: 'actor-1' },
      orderBy: { updatedAt: 'desc' },
    })
    expect(payload.scripts).toHaveLength(1)
  })
})
