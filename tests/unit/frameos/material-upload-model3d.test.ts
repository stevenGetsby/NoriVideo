import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import sharp from 'sharp'

const prismaMock = vi.hoisted(() => ({
  project: { findFirst: vi.fn() },
}))
const storageMock = vi.hoisted(() => ({
  generateUniqueKey: vi.fn(() => 'frameos-material-user-1/model.glb'),
  uploadObject: vi.fn(async (_body: Buffer, key: string) => key),
}))
const registerMaterialMock = vi.hoisted(() => vi.fn(async (input: Record<string, unknown>) => ({
  id: 'material-1',
  ...input,
})))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/storage', () => storageMock)
vi.mock('@/lib/frameos/material-service', () => ({ registerFrameosMaterial: registerMaterialMock }))
vi.mock('@/lib/media/duration-probe', () => ({ probeMediaDurationSeconds: vi.fn(async () => null) }))

import { uploadFrameosMaterial } from '@/lib/frameos/material-upload'

function glbBuffer() {
  const json = Buffer.from(JSON.stringify({ asset: { version: '2.0' }, scenes: [{}], scene: 0 }))
  const paddedLength = Math.ceil(json.length / 4) * 4
  const body = Buffer.alloc(12 + 8 + paddedLength, 0x20)
  body.write('glTF', 0, 'ascii')
  body.writeUInt32LE(2, 4)
  body.writeUInt32LE(body.length, 8)
  body.writeUInt32LE(paddedLength, 12)
  body.writeUInt32LE(0x4e4f534a, 16)
  json.copy(body, 20)
  return body
}

function request(file: File, headers?: HeadersInit) {
  const form = new FormData()
  form.set('file', file)
  form.set('title', '角色模型')
  form.set('projectId', 'project-1')
  return new NextRequest('http://localhost/api/frameos/materials', { method: 'POST', body: form, headers })
}

async function categorizedImageRequest() {
  const png = await sharp({
    create: { width: 2, height: 2, channels: 3, background: '#223344' },
  }).png().toBuffer()
  const form = new FormData()
  form.set('file', new File([Uint8Array.from(png)], 'character.png', { type: 'image/png' }))
  form.set('title', '苏晚卿角色图')
  form.set('projectId', 'project-1')
  form.set('assetCategory', 'character')
  return new NextRequest('http://localhost/api/frameos/materials', { method: 'POST', body: form })
}

const session = { user: { id: 'user-1', name: '测试账号' } }
const verifiedProject = { expectedProjectId: 'project-1', projectAccessVerified: true }

describe('FrameOS model3d material upload', () => {
  beforeEach(() => vi.clearAllMocks())

  it('rejects a .gltf before storage and tells the user to export a self-contained GLB', async () => {
    const file = new File(['{"asset":{"version":"2.0"}}'], 'external.gltf', { type: 'model/gltf+json' })

    await expect(uploadFrameosMaterial(request(file), session, verifiedProject)).rejects.toThrow('暂不支持 .gltf 多文件模型')
    expect(storageMock.uploadObject).not.toHaveBeenCalled()
    expect(registerMaterialMock).not.toHaveBeenCalled()
  })

  it('rejects a malformed .glb before storage', async () => {
    const file = new File([Uint8Array.from(Buffer.from('not-a-glb'))], 'broken.glb', { type: 'model/gltf-binary' })

    await expect(uploadFrameosMaterial(request(file), session, verifiedProject)).rejects.toThrow('请使用自包含的 GLB 2.0 文件')
    expect(storageMock.uploadObject).not.toHaveBeenCalled()
  })

  it('stores a valid self-contained GLB with the normalized media type', async () => {
    const body = glbBuffer()
    const file = new File([Uint8Array.from(body)], 'model.glb', { type: 'application/octet-stream' })

    const response = await uploadFrameosMaterial(request(file), session, verifiedProject)
    expect(response.status).toBe(200)
    expect(storageMock.uploadObject).toHaveBeenCalledWith(
      expect.any(Buffer),
      'frameos-material-user-1/model.glb',
      undefined,
      'model/gltf-binary',
    )
    expect(registerMaterialMock).toHaveBeenCalledWith(expect.objectContaining({
      type: 'model3d',
      storageKey: 'frameos-material-user-1/model.glb',
      metadata: expect.objectContaining({ mimeType: 'model/gltf-binary' }),
    }))
  })

  it('persists a project upload inside its explicit asset category', async () => {
    storageMock.generateUniqueKey.mockReturnValueOnce('frameos-material-user-1/character.jpg')

    const response = await uploadFrameosMaterial(await categorizedImageRequest(), session, verifiedProject)

    expect(response.status).toBe(200)
    expect(registerMaterialMock).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1',
      type: 'image',
      source: 'upload',
      metadata: expect.objectContaining({
        assetCategory: 'character',
        originalName: 'character.png',
      }),
    }))
  })

  it('rejects an oversized Content-Length before buffering multipart form data', async () => {
    const body = glbBuffer()
    const file = new File([Uint8Array.from(body)], 'model.glb', { type: 'model/gltf-binary' })
    const oversizedRequest = request(file, {
      'content-length': String(201 * 1024 * 1024),
    })
    const formDataSpy = vi.spyOn(oversizedRequest, 'formData')

    await expect(uploadFrameosMaterial(oversizedRequest, session, verifiedProject)).rejects.toMatchObject({
      code: 'INVALID_PARAMS',
      message: '素材文件大小必须在 200MB 以内。',
    })
    expect(formDataSpy).not.toHaveBeenCalled()
    expect(storageMock.uploadObject).not.toHaveBeenCalled()
  })

  it('checks File.size before reading its ArrayBuffer', async () => {
    const file = new File(['small fixture'], 'oversized.mp4', { type: 'video/mp4' })
    Object.defineProperty(file, 'size', { value: 200 * 1024 * 1024 + 1 })
    const form = new FormData()
    form.set('file', file)
    form.set('title', '超大视频')
    form.set('projectId', 'project-1')
    const oversizedRequest = request(new File(['placeholder'], 'placeholder.mp4', { type: 'video/mp4' }))
    vi.spyOn(oversizedRequest, 'formData').mockResolvedValue(form)
    const arrayBufferSpy = vi.spyOn(file, 'arrayBuffer')

    await expect(uploadFrameosMaterial(oversizedRequest, session, verifiedProject)).rejects.toMatchObject({
      code: 'INVALID_PARAMS',
    })
    expect(arrayBufferSpy).not.toHaveBeenCalled()
    expect(storageMock.uploadObject).not.toHaveBeenCalled()
  })

  it('returns a clear 429 before parsing when all upload permits are occupied', async () => {
    const releases: Array<() => void> = []
    storageMock.uploadObject.mockImplementation(async (_body: Buffer, key: string) => {
      await new Promise<void>((resolve) => releases.push(resolve))
      return key
    })
    const makeFile = () => {
      const body = glbBuffer()
      return new File([Uint8Array.from(body)], 'model.glb', { type: 'model/gltf-binary' })
    }
    const first = uploadFrameosMaterial(request(makeFile()), session, verifiedProject)
    const second = uploadFrameosMaterial(request(makeFile()), session, verifiedProject)

    await vi.waitFor(() => expect(storageMock.uploadObject).toHaveBeenCalledTimes(2))
    const blockedRequest = request(makeFile())
    const formDataSpy = vi.spyOn(blockedRequest, 'formData')
    try {
      await expect(uploadFrameosMaterial(blockedRequest, session, verifiedProject)).rejects.toMatchObject({
        code: 'RATE_LIMIT',
        status: 429,
        message: '当前素材上传任务较多，为避免内存过载，请稍后重试。',
      })
      expect(formDataSpy).not.toHaveBeenCalled()
    } finally {
      for (const release of releases) release()
      await Promise.allSettled([first, second])
    }
  })
})
