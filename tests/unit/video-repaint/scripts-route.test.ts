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

const OUTLINE = '1. 目标市场版故事核与类型承诺\n北美现代都市复仇短剧。\n\n2. 目标语言与文字系统合同\n英文对白，英文字幕。'
const TARGET_SCRIPT = '《拒领三百万》\n## S1 [老家堂屋 · 日间 · 内] 角色：李建国\n### SH001 [00:00.0-00:02.8]\n镜头：中景'
const STORYBOARD = '## S1 [出租屋 · 夜间 · 内] 角色：林夏\n\n### SH001 [00:00.0-00:02.8]\n镜头：中景\n画面：林夏抬头。'

function storedScript(overrides?: Record<string, unknown>) {
  return {
    id: 'vr_existing',
    title: '改编第一集',
    content: `${OUTLINE}\n\n${STORYBOARD}`,
    status: 'draft',
    sections: {
      version: 2,
      kind: 'video-repaint',
      layout: 'documents',
      episodes: [
        { id: 'vr_existing-doc-outline', title: '目标设定总纲', body: OUTLINE },
        { id: 'vr_existing-doc-storyboard', title: '分镜', body: STORYBOARD },
      ],
      sourceScript: '第1集\n场景：源场景',
      adaptationBrief: '',
      model: '',
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
    outline: OUTLINE,
    targetScript: TARGET_SCRIPT,
    storyboard: STORYBOARD,
    adaptationBrief: '改为北美语境',
    clientRequestId: 'client-request-1',
    sourceAnalysis: { adaptation_contract: { story_invariants: [] } },
    ...overrides,
  }
}

async function post(payload: unknown) {
  const { POST } = await import('@/app/api/video-repaint/scripts/route')
  return await POST(postRequest(payload) as never, { params: Promise.resolve({}) })
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
    const response = await post(validPayload())

    expect(response.status).toBe(401)
    expect(prismaMock.frameosScript.findUnique).not.toHaveBeenCalled()
    expect(prismaMock.frameosScript.create).not.toHaveBeenCalled()
  })

  it('creates a draft with the target script, outline and storyboard, owned by the acting account', async () => {
    const response = await post(validPayload())
    const payload = await response.json()

    expect(response.status).toBe(201)
    expect(prismaMock.frameosScript.findUnique).toHaveBeenCalledWith({
      where: { id: expect.stringMatching(/^vr_[a-f0-9]{32}$/) },
    })
    expect(prismaMock.frameosScript.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'actor-1',
        title: '改编第一集',
        content: `${TARGET_SCRIPT}\n\n${OUTLINE}\n\n${STORYBOARD}`,
        status: 'draft',
        id: expect.stringMatching(/^vr_[a-f0-9]{32}$/),
      }),
    })

    const created = prismaMock.frameosScript.create.mock.calls[0]?.[0]?.data as { id: string; sections: Record<string, unknown> }
    expect(created.sections).toEqual({
      version: 2,
      kind: 'video-repaint',
      layout: 'documents',
      episodes: [
        { id: `${created.id}-doc-script`, title: '目标剧本', body: TARGET_SCRIPT },
        { id: `${created.id}-doc-outline`, title: '目标设定总纲', body: OUTLINE },
        { id: `${created.id}-doc-storyboard`, title: '分镜', body: STORYBOARD },
      ],
      sourceScript: '第1集\n场景：源场景',
      adaptationBrief: '改为北美语境',
      adaptationContract: { story_invariants: [] },
      model: '',
      sourceFileName: '',
    })
    expect(payload.script).toEqual(expect.objectContaining({
      title: '改编第一集',
      type: '视频转绘',
      status: 'draft',
      layout: 'documents',
    }))
    expect(payload.script.episodes.map((episode: { title: string }) => episode.title)).toEqual(['目标剧本', '目标设定总纲', '分镜'])
  })

  it('records the model and source file name when the client sends them', async () => {
    await post(validPayload({ model: 'text-model-x', sourceFileName: 'sample.mp4' }))

    const created = prismaMock.frameosScript.create.mock.calls[0]?.[0]?.data as { sections: Record<string, unknown> }
    expect(created.sections).toMatchObject({ model: 'text-model-x', sourceFileName: 'sample.mp4' })
  })

  it('saves without a storyboard and retains an empty document for later generation', async () => {
    await post(validPayload({ clientRequestId: 'no-storyboard', storyboard: '' }))
    await post(validPayload({ clientRequestId: 'only-storyboard', outline: '   ', targetScript: '' }))

    const [scriptAndOutline, storyboardOnly] = prismaMock.frameosScript.create.mock.calls.map(
      (call) => (call[0] as { data: { content: string; sections: { episodes: Array<{ title: string; body: string }> } } }).data,
    )
    expect(scriptAndOutline.content).toBe(`${TARGET_SCRIPT}\n\n${OUTLINE}`)
    expect(scriptAndOutline.sections.episodes.map((episode) => [episode.title, episode.body])).toEqual([
      ['目标剧本', TARGET_SCRIPT],
      ['目标设定总纲', OUTLINE],
      ['分镜', ''],
    ])
    expect(storyboardOnly.content).toBe(STORYBOARD)
    expect(storyboardOnly.sections.episodes.map((episode) => [episode.title, episode.body])).toEqual([
      ['目标剧本', ''],
      ['目标设定总纲', ''],
      ['分镜', STORYBOARD],
    ])
  })

  it('saves without a source script, which the documents do not need', async () => {
    const response = await post(validPayload({ sourceScript: undefined, clientRequestId: 'no-source' }))

    expect(response.status).toBe(201)
    const created = prismaMock.frameosScript.create.mock.calls[0]?.[0]?.data as { sections: Record<string, unknown> }
    expect(created.sections.sourceScript).toBe('')
  })

  it('returns the existing draft instead of creating a duplicate on retry', async () => {
    prismaMock.frameosScript.findUnique.mockResolvedValue(storedScript())
    const response = await post(validPayload())
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.idempotent).toBe(true)
    expect(payload.script.id).toBe('vr_existing')
    expect(prismaMock.frameosScript.create).not.toHaveBeenCalled()
  })

  it('rejects a replayed request id owned by another account', async () => {
    prismaMock.frameosScript.findUnique.mockResolvedValue(storedScript({ userId: 'actor-2' }))
    const response = await post(validPayload())

    expect(response.status).toBe(409)
    expect((await response.json()).error.code).toBe('CONFLICT')
    expect(prismaMock.frameosScript.create).not.toHaveBeenCalled()
  })

  it('recovers a concurrent duplicate create through the unique constraint', async () => {
    prismaMock.frameosScript.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(storedScript())
    prismaMock.frameosScript.create.mockRejectedValueOnce(Object.assign(new Error('duplicate'), { code: 'P2002' }))
    const response = await post(validPayload())
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.idempotent).toBe(true)
    expect(payload.script.id).toBe('vr_existing')
  })

  it('validates required fields, sizes, and request ids before touching the database', async () => {
    for (const payload of [
      validPayload({ title: '   ' }),
      validPayload({ outline: '', targetScript: '', storyboard: '' }),
      validPayload({ outline: '  ', targetScript: undefined, storyboard: undefined }),
      validPayload({ targetScript: 'x'.repeat(400_001) }),
      validPayload({ outline: 'x'.repeat(400_001) }),
      validPayload({ storyboard: 'x'.repeat(400_001) }),
      validPayload({ sourceScript: 'x'.repeat(400_001) }),
      validPayload({ clientRequestId: 'x'.repeat(201) }),
      validPayload({ sourceAnalysis: { big: 'x'.repeat(2 * 1024 * 1024) } }),
      // The legacy single-script field alone cannot substitute for a generated document.
      { title: '改编第一集', sourceScript: '第1集', resultMode: 'llm' },
    ]) {
      const response = await post(payload)
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
    expect(payload.scripts[0].layout).toBe('documents')
  })
})
