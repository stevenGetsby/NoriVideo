import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { INHERITED_FROM_KEY, MAX_INHERITED_MATERIALS } from '@/lib/frameos/material-inherit'
import { buildMockRequest } from '../../helpers/request'

const session = {
  user: {
    id: 'owner-1', actorId: 'member-1', workspaceOwnerId: 'owner-1',
    name: ' 小  王 ', role: 'member', permissions: [],
  },
}
const authMock = vi.hoisted(() => ({
  requireUserAuth: vi.fn(),
  isErrorResponse: (value: unknown) => value instanceof Response,
}))
const tx = vi.hoisted(() => ({
  project: { create: vi.fn(), findFirst: vi.fn() },
  projectMember: { create: vi.fn() },
  novelPromotionProject: { create: vi.fn() },
  canvas: { create: vi.fn() },
  user: { findMany: vi.fn() },
  frameosMaterial: { findMany: vi.fn(), createMany: vi.fn() },
  mediaObject: {},
}))
// No `frameosMaterial` here: any copy attempted outside the transaction would throw.
const prismaMock = vi.hoisted(() => ({
  userPreference: { findUnique: vi.fn() },
  user: { findMany: vi.fn() },
  $transaction: vi.fn(),
}))
const accessMock = vi.hoisted(() => ({
  getWorkspaceActor: vi.fn(),
  projectReadScopeWhere: vi.fn(),
  projectReadWhere: vi.fn(),
  requireWorkProjectCreator: vi.fn(),
  workspaceUserWhere: vi.fn(),
}))
const styleMock = vi.hoisted(() => ({
  cleanupUploadedProjectStyleReferences: vi.fn(),
  persistProjectStyleReferenceMedia: vi.fn(),
  prepareProjectStyleReferences: vi.fn(),
  uploadProjectStyleReferences: vi.fn(),
}))
vi.mock('@/lib/api-auth', () => authMock)
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/collaboration/access', () => accessMock)
vi.mock('@/lib/projects/style-reference-upload', () => styleMock)
vi.mock('@/lib/logging/core', () => ({ logError: vi.fn(), logInfo: vi.fn(), createScopedLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() }) }))

const routeContext = { params: Promise.resolve({}) }
const BASE_TIME = Date.parse('2026-11-01T00:00:00.000Z')
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

function row(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    userId: 'owner-1',
    projectId: 'source-1',
    personalOwnerId: null,
    ownerName: '原作者',
    title: `素材 ${id}`,
    type: 'image',
    source: 'creative',
    status: 'ready',
    resultUrl: `https://cdn.example/${id}.png`,
    storageKey: `materials/${id}.png`,
    isSuperresolved: false,
    isSubtitleErased: false,
    isFavorited: false,
    metadata: {},
    deletedAt: null,
    createdAt: new Date(BASE_TIME),
    updatedAt: new Date(BASE_TIME),
    ...overrides,
  }
}

function inheritBody(ids: string[], extra: Record<string, unknown> = {}) {
  return {
    name: '新作品',
    workId: 'work-1',
    creationMode: 'canvas',
    createBlankCanvas: 'true',
    inheritSourceProjectId: 'source-1',
    inheritMaterialIds: ids,
    ...extra,
  }
}

function jsonRequest(body: Record<string, unknown>) {
  return buildMockRequest({ path: '/api/projects', method: 'POST', body })
}

type CopyRow = {
  id: string
  userId: string
  projectId: string
  personalOwnerId: string | null
  ownerName: string | null
  title: string | null
  type: string
  source: string
  status: string
  resultUrl: string | null
  storageKey: string | null
  createdAt: Date
  metadata: Record<string, unknown>
}

function createdCopies(): CopyRow[] {
  expect(tx.frameosMaterial.createMany).toHaveBeenCalledTimes(1)
  return tx.frameosMaterial.createMany.mock.calls[0][0].data as CopyRow[]
}

function copyOfSource(copies: CopyRow[], sourceMaterialId: string): CopyRow {
  const found = copies.find((copy) => (copy.metadata[INHERITED_FROM_KEY] as { materialId: string }).materialId === sourceMaterialId)
  if (!found) throw new Error(`no copy of ${sourceMaterialId}`)
  return found
}

async function errorBody(response: Response) {
  return await response.json() as { success: boolean; error: { code: string; message: string; details?: { code?: string } } }
}

describe('POST /api/projects inherits assets into the new canvas 作品', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    authMock.requireUserAuth.mockResolvedValue({ session })
    accessMock.getWorkspaceActor.mockReturnValue({ actorId: 'member-1', workspaceOwnerId: 'owner-1', role: 'member', isManagement: false })
    accessMock.projectReadWhere.mockImplementation((_session: unknown, id: string) => ({ id, readable: true }))
    accessMock.requireWorkProjectCreator.mockResolvedValue({ work: { id: 'work-1', productLine: 'canvas' } })
    accessMock.workspaceUserWhere.mockImplementation((ownerId: string) => ({ OR: [{ id: ownerId }, { workspaceOwnerId: ownerId }] }))
    styleMock.cleanupUploadedProjectStyleReferences.mockResolvedValue(undefined)
    styleMock.persistProjectStyleReferenceMedia.mockResolvedValue([])
    styleMock.prepareProjectStyleReferences.mockResolvedValue([])
    styleMock.uploadProjectStyleReferences.mockResolvedValue([])
    prismaMock.userPreference.findUnique.mockResolvedValue(null)
    prismaMock.user.findMany.mockResolvedValue([])
    prismaMock.$transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) => callback(tx))
    tx.project.create.mockResolvedValue({ id: 'project-1', name: '新作品', workId: 'work-1', createdById: 'member-1' })
    tx.project.findFirst.mockResolvedValue({ id: 'source-1', name: '第一集' })
    tx.projectMember.create.mockResolvedValue({})
    tx.novelPromotionProject.create.mockResolvedValue({ id: 'novel-1' })
    tx.canvas.create.mockResolvedValue({ id: 'canvas-1', projectId: 'project-1', title: '主画布' })
    tx.user.findMany.mockResolvedValue([{ id: 'owner-1' }, { id: 'member-1' }])
    tx.frameosMaterial.findMany.mockResolvedValue([])
    tx.frameosMaterial.createMany.mockResolvedValue({ count: 0 })
  })

  it('copies the chosen rows into the new 作品 inside the creating transaction and reports the result', async () => {
    tx.frameosMaterial.findMany.mockResolvedValueOnce([
      row('img-1', {
        createdAt: new Date(BASE_TIME + 5_000),
        metadata: {
          assetCategory: 'character', prompt: '红脸长髯', taskId: 'task-1', canvasNodeId: 'node-1',
          seedancePrivateAsset: { assetId: 'private-asset' },
        },
      }),
      row('img-2', { createdAt: new Date(BASE_TIME), source: 'upload', ownerName: null, metadata: { originType: 'location_wide' } }),
    ])
    const { POST } = await import('@/app/api/projects/route')
    const response = await POST(jsonRequest(inheritBody(['img-1', 'img-2'])), routeContext)

    expect(response.status).toBe(201)
    expect(prismaMock.$transaction).toHaveBeenCalledOnce()
    const body = await response.json()
    expect(body).toMatchObject({
      work: { id: 'project-1' },
      canvas: { id: 'canvas-1', projectId: 'project-1' },
      inheritedAssets: { sourceProjectId: 'source-1', sourceProjectName: '第一集', copied: 2, voicesCopied: 0, voicesDropped: 0 },
    })

    const copies = createdCopies()
    expect(copies).toHaveLength(2)
    expect(new Set(copies.map((copy) => copy.id)).size).toBe(2)
    for (const copy of copies) {
      expect(copy.id).toMatch(UUID)
      expect(['img-1', 'img-2']).not.toContain(copy.id)
      expect(copy).toMatchObject({ userId: 'owner-1', projectId: 'project-1', personalOwnerId: null, status: 'ready' })
    }

    const first = copyOfSource(copies, 'img-1')
    expect(first).toMatchObject({
      ownerName: '小 王', title: '素材 img-1', type: 'image', source: 'creative',
      resultUrl: 'https://cdn.example/img-1.png', storageKey: 'materials/img-1.png',
    })
    expect(first.metadata).toMatchObject({ assetCategory: 'character', prompt: '红脸长髯' })
    expect(first.metadata[INHERITED_FROM_KEY]).toEqual({ projectId: 'source-1', projectName: '第一集', materialId: 'img-1' })
    for (const key of ['taskId', 'canvasNodeId', 'seedancePrivateAsset']) expect(first.metadata).not.toHaveProperty(key)
    expect(JSON.stringify(first.metadata)).not.toContain('private-asset')

    const second = copyOfSource(copies, 'img-2')
    expect(second).toMatchObject({ source: 'upload', ownerName: '小 王' })
    expect(second.metadata.assetCategory).toBe('location')

    // The newer source row stays newer, so the library keeps the source's order.
    expect(second.createdAt.getTime()).toBeLessThan(first.createdAt.getTime())
    expect(copies[0]).toBe(second)
  })

  it('accepts the multipart body the create dialog actually posts', async () => {
    tx.frameosMaterial.findMany.mockResolvedValueOnce([row('img-1'), row('img-2')])
    const form = new FormData()
    form.set('name', '新作品')
    form.set('creationMode', 'canvas')
    form.set('createBlankCanvas', 'true')
    form.set('parentProjectId', 'work-1')
    form.set('workId', 'work-1')
    form.set('inheritSourceProjectId', 'source-1')
    form.set('inheritMaterialIds', JSON.stringify(['img-1', 'img-2']))
    const request = new NextRequest('http://localhost:3000/api/projects', { method: 'POST', body: form })
    const { POST } = await import('@/app/api/projects/route')
    const response = await POST(request, routeContext)

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({ inheritedAssets: { copied: 2, sourceProjectId: 'source-1' } })
    expect(createdCopies()).toHaveLength(2)
  })

  it('resolves the source through the same read scope as every other project read', async () => {
    tx.frameosMaterial.findMany.mockResolvedValueOnce([row('img-1')])
    const { POST } = await import('@/app/api/projects/route')
    await POST(jsonRequest(inheritBody(['img-1'])), routeContext)

    expect(accessMock.projectReadWhere).toHaveBeenCalledWith(session, 'source-1')
    expect(tx.project.findFirst).toHaveBeenCalledWith({ where: { id: 'source-1', readable: true }, select: { id: true, name: true } })
    expect(tx.frameosMaterial.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['img-1'] },
        userId: { in: ['owner-1', 'member-1'] },
        projectId: 'source-1',
        personalOwnerId: null,
        deletedAt: null,
        status: 'ready',
      },
    })
  })

  it('answers 404 and copies nothing when the source 作品 is missing or not readable', async () => {
    tx.project.findFirst.mockResolvedValueOnce(null)
    const { POST } = await import('@/app/api/projects/route')
    const response = await POST(jsonRequest(inheritBody(['img-1'])), routeContext)

    expect(response.status).toBe(404)
    expect((await errorBody(response)).error.message).toBe('要继承资产的作品不存在或当前账号无权访问。')
    expect(tx.user.findMany).not.toHaveBeenCalled()
    expect(tx.frameosMaterial.findMany).not.toHaveBeenCalled()
    expect(tx.frameosMaterial.createMany).not.toHaveBeenCalled()
    expect(styleMock.cleanupUploadedProjectStyleReferences).toHaveBeenCalledOnce()
  })

  it.each([
    ['an id that is not in the source (another 作品, personal, deleted, unfinished or invented)', [row('img-1')], ['img-1', 'foreign']],
    ['a retired picture that a replacement superseded', [row('img-1'), row('old', { metadata: { supersededByMaterialId: 'new-1' } })], ['img-1', 'old']],
  ])('refuses the whole creation for %s', async (_label, found, requested) => {
    tx.frameosMaterial.findMany.mockResolvedValueOnce(found)
    const { POST } = await import('@/app/api/projects/route')
    const response = await POST(jsonRequest(inheritBody(requested)), routeContext)

    expect(response.status).toBe(400)
    const body = await errorBody(response)
    expect(body.error.message).toBe('所选资产已被删除或无法继承，请重新选择后再创建。')
    expect(body.error.details?.code).toBe('INHERIT_MATERIALS_UNAVAILABLE')
    expect(tx.frameosMaterial.createMany).not.toHaveBeenCalled()
    expect(prismaMock.$transaction).toHaveBeenCalledOnce()
    expect(styleMock.cleanupUploadedProjectStyleReferences).toHaveBeenCalledOnce()
  })

  describe('character voices', () => {
    const characters = [
      row('char-src', { metadata: { assetCategory: 'character', voiceMaterialId: 'voice-src' }, createdAt: new Date(BASE_TIME + 1_000) }),
      row('char-global', { metadata: { assetCategory: 'character', voiceMaterialId: 'voice-global' }, createdAt: new Date(BASE_TIME + 2_000) }),
      row('char-gone', { metadata: { assetCategory: 'character', voiceMaterialId: 'voice-gone' }, createdAt: new Date(BASE_TIME + 3_000) }),
    ]
    const voices = [
      row('voice-src', { type: 'audio', projectId: 'source-1', title: '关羽音色', resultUrl: 'https://cdn.example/voice-src.mp3', storageKey: 'materials/voice-src.mp3', createdAt: new Date(BASE_TIME + 500) }),
      row('voice-global', { type: 'audio', projectId: 'global-asset-hub', title: '通用音色' }),
    ]

    it('copies and remaps a voice of the source 作品, keeps an account-wide voice, and drops any other binding', async () => {
      tx.frameosMaterial.findMany.mockResolvedValueOnce(characters).mockResolvedValueOnce(voices)
      const { POST } = await import('@/app/api/projects/route')
      const response = await POST(jsonRequest(inheritBody(['char-src', 'char-global', 'char-gone'])), routeContext)

      expect(response.status).toBe(201)
      await expect(response.json()).resolves.toMatchObject({
        inheritedAssets: { copied: 3, voicesCopied: 1, voicesDropped: 1 },
      })
      expect(tx.frameosMaterial.findMany).toHaveBeenNthCalledWith(2, {
        where: {
          id: { in: ['voice-src', 'voice-global', 'voice-gone'] },
          userId: { in: ['owner-1', 'member-1'] },
          type: 'audio',
          status: 'ready',
          deletedAt: null,
          personalOwnerId: null,
          projectId: { in: ['source-1', 'global', 'global-asset-hub'] },
        },
      })

      const copies = createdCopies()
      expect(copies).toHaveLength(4)
      const voiceCopy = copyOfSource(copies, 'voice-src')
      expect(voiceCopy).toMatchObject({ projectId: 'project-1', type: 'audio', title: '关羽音色', storageKey: 'materials/voice-src.mp3', status: 'ready' })
      expect(voiceCopy.metadata).not.toHaveProperty('voiceMaterialId')
      expect(copyOfSource(copies, 'char-src').metadata.voiceMaterialId).toBe(voiceCopy.id)
      expect(copyOfSource(copies, 'char-global').metadata.voiceMaterialId).toBe('voice-global')
      expect(copyOfSource(copies, 'char-gone').metadata).not.toHaveProperty('voiceMaterialId')
      expect(copies.some((copy) => copy.id === 'voice-global')).toBe(false)
    })

    it('does not copy a voice twice when it was selected as well as bound', async () => {
      tx.frameosMaterial.findMany
        .mockResolvedValueOnce([characters[0], voices[0]])
        .mockResolvedValueOnce([voices[0]])
      const { POST } = await import('@/app/api/projects/route')
      const response = await POST(jsonRequest(inheritBody(['char-src', 'voice-src'])), routeContext)

      expect(response.status).toBe(201)
      await expect(response.json()).resolves.toMatchObject({ inheritedAssets: { copied: 2, voicesCopied: 0, voicesDropped: 0 } })
      const copies = createdCopies()
      expect(copies).toHaveLength(2)
      expect(copyOfSource(copies, 'char-src').metadata.voiceMaterialId).toBe(copyOfSource(copies, 'voice-src').id)
    })

    it('shares one carried voice between characters that were bound to it', async () => {
      tx.frameosMaterial.findMany
        .mockResolvedValueOnce([
          row('twin-a', { metadata: { voiceMaterialId: 'voice-src' }, createdAt: new Date(BASE_TIME + 1_000) }),
          row('twin-b', { metadata: { voiceMaterialId: 'voice-src' }, createdAt: new Date(BASE_TIME + 2_000) }),
        ])
        .mockResolvedValueOnce([voices[0]])
      const { POST } = await import('@/app/api/projects/route')
      const response = await POST(jsonRequest(inheritBody(['twin-a', 'twin-b'])), routeContext)

      expect(response.status).toBe(201)
      await expect(response.json()).resolves.toMatchObject({ inheritedAssets: { copied: 2, voicesCopied: 1, voicesDropped: 0 } })
      const copies = createdCopies()
      expect(copies).toHaveLength(3)
      const voiceCopy = copyOfSource(copies, 'voice-src')
      expect(copyOfSource(copies, 'twin-a').metadata.voiceMaterialId).toBe(voiceCopy.id)
      expect(copyOfSource(copies, 'twin-b').metadata.voiceMaterialId).toBe(voiceCopy.id)
    })

    it('does not look voices up when nothing is bound', async () => {
      tx.frameosMaterial.findMany.mockResolvedValueOnce([row('plain-1')])
      const { POST } = await import('@/app/api/projects/route')
      await POST(jsonRequest(inheritBody(['plain-1'])), routeContext)
      expect(tx.frameosMaterial.findMany).toHaveBeenCalledTimes(1)
    })
  })

  describe('limits and request shape', () => {
    it('allows exactly the cap', async () => {
      const ids = Array.from({ length: MAX_INHERITED_MATERIALS }, (_, index) => `m-${index}`)
      tx.frameosMaterial.findMany.mockResolvedValueOnce(ids.map((id, index) => row(id, { createdAt: new Date(BASE_TIME + index) })))
      const { POST } = await import('@/app/api/projects/route')
      const response = await POST(jsonRequest(inheritBody(ids)), routeContext)

      expect(response.status).toBe(201)
      await expect(response.json()).resolves.toMatchObject({ inheritedAssets: { copied: MAX_INHERITED_MATERIALS } })
      const copies = createdCopies()
      expect(copies).toHaveLength(MAX_INHERITED_MATERIALS)
      const times = copies.map((copy) => copy.createdAt.getTime())
      expect(times).toEqual([...times].sort((left, right) => left - right))
      expect(new Set(times).size).toBe(MAX_INHERITED_MATERIALS)
    })

    it.each([
      ['more than the cap', inheritBody(Array.from({ length: MAX_INHERITED_MATERIALS + 1 }, (_, index) => `m-${index}`)), 'INHERIT_MATERIALS_LIMIT'],
      ['no ids', inheritBody([]), 'INHERIT_MATERIALS_REQUIRED'],
      ['ids without a source', { ...inheritBody(['a']), inheritSourceProjectId: '' }, 'INHERIT_SOURCE_REQUIRED'],
      ['a malformed id list', inheritBody(['a'], { inheritMaterialIds: '{nope' }), 'INHERIT_MATERIALS_INVALID'],
      ['non-string ids', inheritBody(['a'], { inheritMaterialIds: ['a', 7] }), 'INHERIT_MATERIALS_INVALID'],
    ])('rejects %s before anything is written', async (_label, body, code) => {
      const { POST } = await import('@/app/api/projects/route')
      const response = await POST(jsonRequest(body), routeContext)

      expect(response.status).toBe(400)
      expect((await errorBody(response)).error.details?.code).toBe(code)
      expect(prismaMock.$transaction).not.toHaveBeenCalled()
      expect(styleMock.uploadProjectStyleReferences).not.toHaveBeenCalled()
    })

    it.each([
      ['workflow', { creationMode: 'workflow', createBlankCanvas: undefined }],
      ['unspecified', { creationMode: undefined, createBlankCanvas: undefined }],
      ['an explicit no-canvas flag', { creationMode: undefined, createBlankCanvas: 'false' }],
    ])('only inherits when a canvas is created (%s mode)', async (_label, overrides) => {
      const { POST } = await import('@/app/api/projects/route')
      const response = await POST(jsonRequest(inheritBody(['img-1'], overrides)), routeContext)

      expect(response.status).toBe(400)
      const body = await errorBody(response)
      expect(body.error.details?.code).toBe('INHERIT_REQUIRES_CANVAS')
      expect(body.error.message).toBe('只有以画布方式创建作品时才能继承资产。')
      expect(prismaMock.$transaction).not.toHaveBeenCalled()
    })

    it('treats a request without inherit fields exactly as before', async () => {
      const { POST } = await import('@/app/api/projects/route')
      const response = await POST(jsonRequest({ name: '新作品', workId: 'work-1', creationMode: 'canvas', createBlankCanvas: 'true' }), routeContext)

      expect(response.status).toBe(201)
      await expect(response.json()).resolves.toMatchObject({ inheritedAssets: null, canvas: { id: 'canvas-1' } })
      expect(tx.project.findFirst).not.toHaveBeenCalled()
      expect(tx.frameosMaterial.findMany).not.toHaveBeenCalled()
      expect(tx.frameosMaterial.createMany).not.toHaveBeenCalled()
    })

    it('treats blank inherit fields as no inheritance', async () => {
      const { POST } = await import('@/app/api/projects/route')
      const response = await POST(jsonRequest(inheritBody([], { inheritSourceProjectId: '  ', inheritMaterialIds: '' })), routeContext)

      expect(response.status).toBe(201)
      await expect(response.json()).resolves.toMatchObject({ inheritedAssets: null })
      expect(tx.frameosMaterial.createMany).not.toHaveBeenCalled()
    })
  })

  describe('atomicity', () => {
    it('fails the whole creation, and cleans up uploads, when the copy cannot be written', async () => {
      tx.frameosMaterial.findMany.mockResolvedValueOnce([row('img-1')])
      tx.frameosMaterial.createMany.mockRejectedValueOnce(new Error('materials table unavailable'))
      const { POST } = await import('@/app/api/projects/route')
      const response = await POST(jsonRequest(inheritBody(['img-1'])), routeContext)

      expect(response.status).toBeGreaterThanOrEqual(500)
      expect(prismaMock.$transaction).toHaveBeenCalledOnce()
      expect(tx.project.create).toHaveBeenCalledOnce()
      expect(styleMock.cleanupUploadedProjectStyleReferences).toHaveBeenCalledOnce()
      const body = await response.json()
      expect(body.success).toBe(false)
      expect(body).not.toHaveProperty('work')
      expect(body).not.toHaveProperty('inheritedAssets')
    })

    it('copies after the canvas exists so an inherited 作品 always has its canvas', async () => {
      tx.frameosMaterial.findMany.mockResolvedValueOnce([row('img-1')])
      const { POST } = await import('@/app/api/projects/route')
      await POST(jsonRequest(inheritBody(['img-1'])), routeContext)

      const canvasOrder = tx.canvas.create.mock.invocationCallOrder[0]
      const copyOrder = tx.frameosMaterial.createMany.mock.invocationCallOrder[0]
      expect(canvasOrder).toBeLessThan(copyOrder)
    })
  })
})
