import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import sharp from 'sharp'

const authMock = vi.hoisted(() => vi.fn())
const prismaMock = vi.hoisted(() => {
  const client = {
    project: { findFirst: vi.fn() },
    frameosMaterial: { findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
  }
  return {
    ...client,
    $transaction: vi.fn(async (operation: (tx: typeof client) => unknown, _options?: unknown) => await operation(client)),
  }
})
const storageMock = vi.hoisted(() => ({
  generateUniqueKey: vi.fn(() => 'frameos-material-owner-1/replacement.jpg'),
  uploadObject: vi.fn(async (_body: Buffer, key: string) => key),
}))
const mediaMock = vi.hoisted(() => ({
  ensureMediaObjectFromStorageKey: vi.fn(async (key: string) => ({ url: `/api/media/${key}` })),
}))
const referenceMock = vi.hoisted(() => ({ findCanvasMaterialReferences: vi.fn() }))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/storage', () => storageMock)
vi.mock('@/lib/media/service', () => mediaMock)
vi.mock('@/lib/canvas/material-reference-guard', () => referenceMock)
vi.mock('@/lib/frameos/material-service', () => ({ registerFrameosMaterial: vi.fn() }))
vi.mock('@/lib/media/duration-probe', () => ({ probeMediaDurationSeconds: vi.fn(async () => null) }))
vi.mock('@/lib/api-auth', () => ({
  requireUserPermission: authMock,
  isErrorResponse: (value: unknown) => value instanceof Response,
}))

import { POST } from '@/app/api/frameos/materials/[materialId]/replace-image/route'

const context = { params: Promise.resolve({ materialId: 'material-1' }) }
const updatedAt = new Date('2026-11-01T00:00:00.000Z')
const ownerSession = {
  user: { id: 'owner-1', actorId: 'owner-1', workspaceOwnerId: 'owner-1', name: '管理员', role: 'admin' },
}
const memberSession = {
  user: { id: 'workspace-1', actorId: 'member-1', workspaceOwnerId: 'workspace-1', name: '项目成员', role: 'editor' },
}
const noReferences = { referenced: false, counts: { currentCanvases: 0, workflowTemplates: 0, historySnapshots: 3 } }
const characterCard = {
  id: 'material-1',
  userId: 'owner-1',
  personalOwnerId: null,
  projectId: 'project-1',
  ownerName: '管理员',
  title: '关羽',
  type: 'image',
  source: 'upload',
  status: 'ready',
  isFavorited: true,
  resultUrl: '/api/media/old.jpg',
  storageKey: 'frameos-material-owner-1/old.jpg',
  deletedAt: null,
  deletedById: null,
  updatedAt,
  metadata: {
    assetCategory: 'character',
    prompt: '红脸长髯',
    voiceMaterialId: 'voice-1',
    originalName: '旧形象.png',
    mimeType: 'image/jpeg',
    sizeBytes: 99,
    width: 100,
    height: 100,
    durationSeconds: 3,
  },
}
const readyVoice = { id: 'voice-1', updatedAt: new Date('2026-10-30T00:00:00.000Z') }

type Row = Record<string, unknown>
const state: { material: Row | null; voice: Row | null } = { material: null, voice: null }

async function pngBytes(width = 8, height = 4) {
  return Uint8Array.from(await sharp({ create: { width, height, channels: 3, background: '#aa3322' } }).png().toBuffer())
}

async function replaceRequest(file?: File | null, headers?: HeadersInit) {
  const form = new FormData()
  if (file !== null) form.set('file', file ?? new File([await pngBytes()], '新形象.png', { type: 'image/png' }))
  return new NextRequest('http://localhost/api/frameos/materials/material-1/replace-image', { method: 'POST', body: form, headers })
}

async function failure(response: Response) {
  const body = await response.json() as { error?: { code?: string; message?: string } }
  return { status: response.status, code: body.error?.code, message: body.error?.message }
}

function expectNothingWritten() {
  expect(storageMock.uploadObject).not.toHaveBeenCalled()
  expect(prismaMock.$transaction).not.toHaveBeenCalled()
  expect(prismaMock.frameosMaterial.create).not.toHaveBeenCalled()
  expect(prismaMock.frameosMaterial.updateMany).not.toHaveBeenCalled()
}

describe('FrameOS library image replacement route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.material = { ...characterCard }
    state.voice = { ...readyVoice }
    authMock.mockReset()
    authMock.mockResolvedValue({ session: ownerSession })
    prismaMock.project.findFirst.mockReset()
    prismaMock.project.findFirst.mockResolvedValue({ id: 'project-1' })
    prismaMock.frameosMaterial.findFirst.mockReset()
    prismaMock.frameosMaterial.findFirst.mockImplementation(async ({ where }: { where: { id?: string; type?: string } }) => {
      if (where.type === 'audio') return state.voice
      return where.id === state.material?.id ? state.material : null
    })
    prismaMock.frameosMaterial.create.mockReset()
    prismaMock.frameosMaterial.create.mockImplementation(async ({ data }: { data: Row }) => ({
      id: 'material-new',
      createdAt: new Date('2026-11-12T00:00:00.000Z'),
      updatedAt: new Date('2026-11-12T00:00:00.000Z'),
      deletedAt: null,
      deletedById: null,
      ...data,
    }))
    prismaMock.frameosMaterial.updateMany.mockReset()
    prismaMock.frameosMaterial.updateMany.mockResolvedValue({ count: 1 })
    referenceMock.findCanvasMaterialReferences.mockReset()
    referenceMock.findCanvasMaterialReferences.mockResolvedValue(noReferences)
  })

  it('requires assetWrite and does nothing when authentication fails', async () => {
    authMock.mockResolvedValueOnce(NextResponse.json({ error: 'forbidden' }, { status: 403 }))
    const response = await POST(await replaceRequest(), context)
    expect(response.status).toBe(403)
    expect(authMock).toHaveBeenCalledWith(['assetWrite'])
    expect(prismaMock.frameosMaterial.findFirst).not.toHaveBeenCalled()
    expectNothingWritten()
  })

  it('creates a new row that keeps name, project, category and voice, then trashes an unreferenced original', async () => {
    const response = await POST(await replaceRequest(), context)

    expect(response.status).toBe(200)
    expect(authMock).toHaveBeenCalledWith(['assetWrite'])
    expect(prismaMock.frameosMaterial.findFirst).toHaveBeenNthCalledWith(1, { where: { id: 'material-1', userId: 'owner-1' } })
    expect(prismaMock.project.findFirst).toHaveBeenCalled()

    expect(storageMock.uploadObject).toHaveBeenCalledWith(expect.any(Buffer), 'frameos-material-owner-1/replacement.jpg', undefined, 'image/jpeg')
    expect(mediaMock.ensureMediaObjectFromStorageKey).toHaveBeenCalledWith('frameos-material-owner-1/replacement.jpg')
    expect(prismaMock.$transaction).toHaveBeenCalledWith(expect.any(Function), { timeout: 30_000 })

    const { data } = prismaMock.frameosMaterial.create.mock.calls[0][0] as { data: Row & { metadata: Row } }
    expect(data).toMatchObject({
      userId: 'owner-1',
      personalOwnerId: null,
      projectId: 'project-1',
      ownerName: '管理员',
      title: '关羽',
      type: 'image',
      source: 'upload',
      status: 'ready',
      isFavorited: true,
      resultUrl: '/api/media/frameos-material-owner-1/replacement.jpg',
      storageKey: 'frameos-material-owner-1/replacement.jpg',
    })
    expect(data.metadata).toMatchObject({
      assetCategory: 'character',
      prompt: '红脸长髯',
      voiceMaterialId: 'voice-1',
      originalName: '新形象.png',
      mimeType: 'image/jpeg',
      width: 8,
      height: 4,
      replacesMaterialId: 'material-1',
    })
    expect(data.metadata.sizeBytes).toBeGreaterThan(0)
    expect(data.metadata).not.toHaveProperty('durationSeconds')
    expect(data.metadata).not.toHaveProperty('supersededByMaterialId')

    expect(referenceMock.findCanvasMaterialReferences).toHaveBeenCalledWith(
      expect.anything(), 'owner-1', expect.objectContaining({ id: 'material-1' }),
    )
    expect(prismaMock.frameosMaterial.updateMany).toHaveBeenLastCalledWith({
      where: { id: 'material-1', userId: 'owner-1', projectId: 'project-1', source: 'upload', updatedAt, deletedAt: null },
      data: { deletedAt: expect.any(Date), deletedById: 'owner-1', isFavorited: false },
    })

    await expect(response.json()).resolves.toMatchObject({
      success: true,
      material: { id: 'material-new', title: '关羽', projectId: 'project-1', projectName: '项目素材' },
      previousMaterialId: 'material-1',
      retired: 'trashed',
      referenceCounts: noReferences.counts,
      voiceKept: true,
      voiceDropped: false,
    })
  })

  it('locks the kept voice before creating the replacement so a concurrent voice deletion fails its updatedAt guard', async () => {
    await POST(await replaceRequest(), context)
    const calls = prismaMock.frameosMaterial.updateMany.mock.calls.map(([arg]) => arg as { where: Row; data: Row })
    expect(calls[0].where).toEqual({ id: 'voice-1', type: 'audio', status: 'ready', deletedAt: null })
    expect((calls[0].data.updatedAt as Date).getTime()).toBeGreaterThan(readyVoice.updatedAt.getTime())
    expect(prismaMock.frameosMaterial.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'voice-1', userId: 'owner-1', type: 'audio', status: 'ready', deletedAt: null }),
    }))
    expect(prismaMock.frameosMaterial.updateMany.mock.invocationCallOrder[0])
      .toBeLessThan(prismaMock.frameosMaterial.create.mock.invocationCallOrder[0])
  })

  it('keeps a referenced original alive for the canvases that use it and hides it behind the replacement id', async () => {
    const counts = { currentCanvases: 2, workflowTemplates: 1, historySnapshots: 5 }
    referenceMock.findCanvasMaterialReferences.mockResolvedValue({ referenced: true, counts })

    const response = await POST(await replaceRequest(), context)

    expect(response.status).toBe(200)
    const retire = prismaMock.frameosMaterial.updateMany.mock.calls.at(-1)?.[0] as { where: Row; data: Row & { metadata: Row } }
    expect(retire.where).toMatchObject({ id: 'material-1', updatedAt, deletedAt: null })
    expect(retire.data).not.toHaveProperty('deletedAt')
    expect(retire.data.isFavorited).toBe(false)
    expect(retire.data.metadata).toEqual({ ...characterCard.metadata, supersededByMaterialId: 'material-new' })
    await expect(response.json()).resolves.toMatchObject({
      retired: 'superseded', previousMaterialId: 'material-1', referenceCounts: counts, voiceKept: true,
    })
  })

  it('reports a dropped voice instead of linking the new picture to audio that is gone', async () => {
    state.voice = null

    const response = await POST(await replaceRequest(), context)

    expect(response.status).toBe(200)
    const { data } = prismaMock.frameosMaterial.create.mock.calls[0][0] as { data: { metadata: Row } }
    expect(data.metadata).not.toHaveProperty('voiceMaterialId')
    expect(data.metadata.assetCategory).toBe('character')
    expect(prismaMock.frameosMaterial.updateMany).toHaveBeenCalledTimes(1)
    await expect(response.json()).resolves.toMatchObject({ voiceKept: false, voiceDropped: true })
  })

  it('does not look for a voice when the picture never had one', async () => {
    state.material = { ...characterCard, metadata: { assetCategory: 'location', prompt: '关帝庙' } }

    const response = await POST(await replaceRequest(), context)

    expect(response.status).toBe(200)
    expect(prismaMock.frameosMaterial.findFirst).not.toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ type: 'audio' }),
    }))
    const { data } = prismaMock.frameosMaterial.create.mock.calls[0][0] as { data: { metadata: Row } }
    expect(data.metadata).toMatchObject({ assetCategory: 'location', prompt: '关帝庙' })
    await expect(response.json()).resolves.toMatchObject({ voiceKept: false, voiceDropped: false })
  })

  it('creates nothing when the voice was deleted between the check and the lock', async () => {
    prismaMock.frameosMaterial.updateMany.mockResolvedValueOnce({ count: 0 })

    const result = await failure(await POST(await replaceRequest(), context))

    expect(result).toEqual({ status: 409, code: 'CONFLICT', message: '音色已被删除或正在变更，请稍后重试。' })
    expect(prismaMock.frameosMaterial.create).not.toHaveBeenCalled()
    expect(prismaMock.frameosMaterial.updateMany).toHaveBeenCalledTimes(1)
  })

  it('fails the whole replacement when the original changed underneath it', async () => {
    state.material = { ...characterCard, metadata: { assetCategory: 'location' } }
    prismaMock.frameosMaterial.updateMany.mockResolvedValue({ count: 0 })

    const result = await failure(await POST(await replaceRequest(), context))

    expect(result).toEqual({ status: 409, code: 'CONFLICT', message: '素材已发生变化，请刷新后重试。' })
  })

  it('answers 404 when the original is retired by someone else after the upload was accepted', async () => {
    let lookups = 0
    prismaMock.frameosMaterial.findFirst.mockImplementation(async ({ where }: { where: { type?: string } }) => {
      if (where.type === 'audio') return state.voice
      lookups += 1
      return lookups === 1 ? state.material : { ...characterCard, deletedAt: new Date() }
    })

    const result = await failure(await POST(await replaceRequest(), context))

    expect(result.status).toBe(404)
    expect(prismaMock.frameosMaterial.create).not.toHaveBeenCalled()
    expect(prismaMock.frameosMaterial.updateMany).not.toHaveBeenCalled()
  })

  describe('fails before the upload is read, stored or decoded', () => {
    const cases: Array<[string, () => void, number, string]> = [
      ['an unknown id', () => { state.material = null }, 404, 'NOT_FOUND'],
      ['a trashed picture', () => { state.material = { ...characterCard, deletedAt: new Date() } }, 404, 'NOT_FOUND'],
      ['a picture another member keeps in the personal pool', () => {
        state.material = { ...characterCard, projectId: 'personal', personalOwnerId: 'someone-else' }
      }, 404, 'NOT_FOUND'],
      ['a picture that was already replaced for canvases', () => {
        state.material = { ...characterCard, metadata: { ...characterCard.metadata, supersededByMaterialId: 'material-9' } }
      }, 404, 'NOT_FOUND'],
      ['a project the member cannot read', () => { prismaMock.project.findFirst.mockResolvedValue(null) }, 404, 'NOT_FOUND'],
      ['a video', () => { state.material = { ...characterCard, type: 'video' } }, 400, 'INVALID_PARAMS'],
      ['a generated result', () => { state.material = { ...characterCard, source: 'toolbox' } }, 403, 'FORBIDDEN'],
      ['a picture already bound to a project character', () => {
        state.material = { ...characterCard, metadata: { ...characterCard.metadata, characterId: 'char-1', characterName: '关羽' } }
      }, 409, 'CONFLICT'],
    ]

    it.each(cases)('for %s', async (_label, arrange, status, code) => {
      arrange()
      const request = await replaceRequest()
      const formData = vi.spyOn(request, 'formData')

      const result = await failure(await POST(request, context))

      expect(result.status).toBe(status)
      expect(result.code).toBe(code)
      expect(formData).not.toHaveBeenCalled()
      expectNothingWritten()
    })

    it('for a body larger than the upload limit', async () => {
      const request = await replaceRequest(undefined, { 'content-length': String(201 * 1024 * 1024) })
      const formData = vi.spyOn(request, 'formData')

      const result = await failure(await POST(request, context))

      expect(result).toMatchObject({ status: 400, code: 'INVALID_PARAMS', message: '素材文件大小必须在 200MB 以内。' })
      expect(formData).not.toHaveBeenCalled()
      expect(prismaMock.frameosMaterial.findFirst).not.toHaveBeenCalled()
      expectNothingWritten()
    })
  })

  describe('rejects an unusable file without storing anything', () => {
    it.each([
      ['no file', null, '请选择要替换的图片。'],
      ['an empty file', new File([], '空.png', { type: 'image/png' }), '素材文件大小必须在 200MB 以内。'],
      ['a text file', new File(['x'], '说明.txt', { type: 'text/plain' }), '请选择图片文件（JPG、PNG、WebP 等）。'],
      ['a video', new File([new Uint8Array([1, 2, 3])], '片段.mp4', { type: 'video/mp4' }), '请选择图片文件（JPG、PNG、WebP 等）。'],
      ['bytes that are not an image', new File([new Uint8Array([1, 2, 3, 4])], '损坏.png', { type: 'image/png' }), '无法读取这张图片，请更换文件。'],
    ])('for %s', async (_label, file, message) => {
      const result = await failure(await POST(await replaceRequest(file), context))

      expect(result).toMatchObject({ status: 400, code: 'INVALID_PARAMS', message })
      expect(storageMock.uploadObject).not.toHaveBeenCalled()
      expect(prismaMock.$transaction).not.toHaveBeenCalled()
      expect(prismaMock.frameosMaterial.create).not.toHaveBeenCalled()
    })

    it('rejects a file over the size cap without decoding it', async () => {
      const file = new File(['tiny'], '超大.png', { type: 'image/png' })
      Object.defineProperty(file, 'size', { value: 200 * 1024 * 1024 + 1 })
      const request = await replaceRequest()
      const form = new FormData()
      form.set('file', file)
      vi.spyOn(request, 'formData').mockResolvedValue(form)
      const arrayBuffer = vi.spyOn(file, 'arrayBuffer')

      const result = await failure(await POST(request, context))

      expect(result).toMatchObject({ status: 400, message: '素材文件大小必须在 200MB 以内。' })
      expect(arrayBuffer).not.toHaveBeenCalled()
      expect(storageMock.uploadObject).not.toHaveBeenCalled()
    })

    it('stores a generic-MIME image by its extension', async () => {
      const response = await POST(await replaceRequest(new File([await pngBytes()], '换装.PNG')), context)
      expect(response.status).toBe(200)
      expect(storageMock.uploadObject).toHaveBeenCalledTimes(1)
    })
  })

  describe('as a project member', () => {
    it('stays inside the shared workspace and records who retired the original', async () => {
      authMock.mockResolvedValue({ session: memberSession })
      state.material = { ...characterCard, userId: 'workspace-1', ownerName: '管理员' }

      const response = await POST(await replaceRequest(), context)

      expect(response.status).toBe(200)
      expect(prismaMock.frameosMaterial.findFirst).toHaveBeenNthCalledWith(1, { where: { id: 'material-1', userId: 'workspace-1' } })
      expect(prismaMock.project.findFirst).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ id: 'project-1', userId: 'workspace-1' }),
      }))
      const { data } = prismaMock.frameosMaterial.create.mock.calls[0][0] as { data: Row }
      expect(data).toMatchObject({ userId: 'workspace-1', ownerName: '项目成员', projectId: 'project-1' })
      expect(prismaMock.frameosMaterial.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
        where: expect.objectContaining({ userId: 'workspace-1' }),
        data: expect.objectContaining({ deletedById: 'member-1' }),
      }))
      expect(referenceMock.findCanvasMaterialReferences).toHaveBeenCalledWith(expect.anything(), 'workspace-1', expect.anything())
    })

    it('replaces the member own personal picture and keeps it personal', async () => {
      authMock.mockResolvedValue({ session: memberSession })
      state.material = { ...characterCard, userId: 'workspace-1', projectId: 'personal', personalOwnerId: 'member-1' }

      const response = await POST(await replaceRequest(), context)

      expect(response.status).toBe(200)
      expect(prismaMock.project.findFirst).not.toHaveBeenCalled()
      const { data } = prismaMock.frameosMaterial.create.mock.calls[0][0] as { data: Row }
      expect(data).toMatchObject({ userId: 'workspace-1', projectId: 'personal', personalOwnerId: 'member-1' })
      await expect(response.json()).resolves.toMatchObject({ material: { projectName: '个人素材' } })
    })
  })

  it('keeps an account-level picture account-level', async () => {
    state.material = { ...characterCard, projectId: 'global' }

    const response = await POST(await replaceRequest(), context)

    expect(response.status).toBe(200)
    expect(prismaMock.project.findFirst).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toMatchObject({ material: { projectId: 'global', projectName: '账号素材' } })
  })
})
