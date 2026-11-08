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

  it('registers a member upload under the shared workspace owner and preserves the project scope', async () => {
    const memberSession = {
      user: {
        id: 'workspace-1',
        actorId: 'member-1',
        workspaceOwnerId: 'workspace-1',
        name: '项目成员',
      },
    }
    const response = await uploadFrameosMaterial(await categorizedImageRequest(), memberSession, verifiedProject)
    expect(response.status).toBe(200)
    expect(registerMaterialMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'workspace-1',
      projectId: 'project-1',
      ownerName: '项目成员',
    }))
    expect(registerMaterialMock).not.toHaveBeenCalledWith(expect.objectContaining({ userId: 'member-1' }))
  })

  it('keeps project upload context for authorization while defaulting the new file to the acting member personal pool', async () => {
    const memberSession = {
      user: { id: 'workspace-1', actorId: 'member-1', workspaceOwnerId: 'workspace-1', name: '项目成员' },
    }
    const uploadRequest = await categorizedImageRequest()
    const form = await uploadRequest.clone().formData()
    form.set('projectId', 'personal')
    const response = await uploadFrameosMaterial(new NextRequest(uploadRequest.url, { method: 'POST', body: form }), memberSession, verifiedProject)
    expect(response.status).toBe(200)
    expect(registerMaterialMock).toHaveBeenCalledWith(expect.objectContaining({ userId: 'workspace-1', projectId: 'personal', personalOwnerId: 'member-1', ownerName: '项目成员' }))
    expect(prismaMock.project.findFirst).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toMatchObject({ material: { projectName: '个人素材' } })
  })

  it('rejects an unaffiliated project upload before reading the file or writing storage', async () => {
    prismaMock.project.findFirst.mockResolvedValueOnce(null)
    const file = new File([Uint8Array.from(glbBuffer())], 'model.glb', { type: 'model/gltf-binary' })
    const memberSession = {
      user: { id: 'workspace-1', actorId: 'member-1', workspaceOwnerId: 'workspace-1', name: '非项目成员' },
    }
    await expect(uploadFrameosMaterial(request(file), memberSession)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(prismaMock.project.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'project-1',
        userId: 'workspace-1',
        deletedAt: null,
        work: {
          OR: [
            { createdById: 'member-1' },
            { members: { some: { userId: 'member-1' } } },
          ],
        },
      },
      select: { id: true },
    })
    expect(storageMock.uploadObject).not.toHaveBeenCalled()
    expect(registerMaterialMock).not.toHaveBeenCalled()
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

  it('uploads a scene immediately after a character, including a generic-MIME image', async () => {
    await uploadFrameosMaterial(await categorizedImageRequest(), session, verifiedProject)
    const png = await sharp({ create: { width: 4, height: 3, channels: 3, background: '#123456' } }).png().toBuffer()
    const form = new FormData()
    form.set('file', new File([Uint8Array.from(png)], '工厂夜景.PNG'))
    form.set('title', '工厂夜景')
    form.set('projectId', 'project-1')
    form.set('assetCategory', 'location')
    const response = await uploadFrameosMaterial(new NextRequest('http://localhost/api/frameos/materials', { method: 'POST', body: form }), session, verifiedProject)
    expect(response.status).toBe(200)
    expect(registerMaterialMock).toHaveBeenLastCalledWith(expect.objectContaining({
      projectId: 'project-1', type: 'image', title: '工厂夜景',
      metadata: expect.objectContaining({ assetCategory: 'location', mimeType: 'image/jpeg' }),
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

  it('maps a disabled object-storage account to a safe actionable upload error', async () => {
    storageMock.uploadObject.mockRejectedValueOnce(new Error(
      'TOS_PUT_FAILED: 403 Forbidden <Code>AccountDisabled</Code><Message>Your account has been disabled due to overdue bills.</Message>',
    ))
    const file = new File([Uint8Array.from(glbBuffer())], 'model.glb', { type: 'model/gltf-binary' })

    await expect(uploadFrameosMaterial(request(file), session, verifiedProject)).rejects.toMatchObject({
      code: 'EXTERNAL_ERROR',
      status: 502,
      message: '平台素材存储暂不可用，请联系管理员检查对象存储账户状态。',
      details: expect.objectContaining({ storageStatus: 'account_disabled' }),
    })
    expect(registerMaterialMock).not.toHaveBeenCalled()
  })

  it('queues a third upload instead of failing when all permits are occupied', async () => {
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
    const queuedRequest = request(makeFile())
    const formDataSpy = vi.spyOn(queuedRequest, 'formData')
    let settled = false
    const third = uploadFrameosMaterial(queuedRequest, session, verifiedProject)
      .finally(() => { settled = true })
    try {
      await new Promise((resolve) => setTimeout(resolve, 40))
      expect(settled).toBe(false)
      expect(formDataSpy).not.toHaveBeenCalled()

      releases.splice(0).forEach((release) => release())
      await vi.waitFor(() => expect(storageMock.uploadObject).toHaveBeenCalledTimes(3))
      expect(formDataSpy).toHaveBeenCalledTimes(1)
      releases.splice(0).forEach((release) => release())
      await expect(third).resolves.toMatchObject({ status: 200 })
      await Promise.all([first, second])
    } finally {
      releases.splice(0).forEach((release) => release())
      await Promise.allSettled([first, second, third])
    }
  })

  it('returns a clear 429 only when the bounded wait queue is saturated', async () => {
    const releases: Array<() => void> = []
    storageMock.uploadObject.mockImplementation(async (_body: Buffer, key: string) => {
      await new Promise<void>((resolve) => releases.push(resolve))
      return key
    })
    const makeFile = () => {
      const body = glbBuffer()
      return new File([Uint8Array.from(body)], 'model.glb', { type: 'model/gltf-binary' })
    }
    const makeRequest = () => request(makeFile())
    const pending = Array.from({ length: 10 }, () => uploadFrameosMaterial(makeRequest(), session, verifiedProject))
    const overflowRequest = request(makeFile())
    const formDataSpy = vi.spyOn(overflowRequest, 'formData')
    let unsettled = pending.length
    const tracked = pending.map((promise) => promise.then(
      () => { unsettled -= 1 },
      () => { unsettled -= 1 },
    ))
    try {
      await expect(uploadFrameosMaterial(overflowRequest, session, verifiedProject)).rejects.toMatchObject({
        code: 'RATE_LIMIT',
        status: 429,
        message: '当前素材上传任务较多，为避免内存过载，请稍后重试。',
      })
      expect(formDataSpy).not.toHaveBeenCalled()
    } finally {
      // Drain every occupied permit, including permits that are only acquired
      // after an earlier upload finishes normalization.
      let guard = 0
      while (unsettled > 0 && guard < 500) {
        guard += 1
        if (releases.length === 0) {
          await new Promise((resolve) => setTimeout(resolve, 10))
          continue
        }
        releases.splice(0).forEach((release) => release())
      }
      await Promise.all(tracked)
    }
  })

  it('cancels a queued upload when the request aborts and keeps the pool usable', async () => {
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

    const controller = new AbortController()
    const form = new FormData()
    form.set('file', makeFile())
    form.set('title', '取消的模型')
    form.set('projectId', 'project-1')
    const abortedRequest = new NextRequest('http://localhost/api/frameos/materials', {
      method: 'POST',
      body: form,
      signal: controller.signal,
    })
    const aborted = uploadFrameosMaterial(abortedRequest, session, verifiedProject)
    controller.abort()

    await expect(aborted).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
      message: '上传请求已取消。',
    })

    releases.splice(0).forEach((release) => release())
    await Promise.all([first, second])

    // The aborted waiter must not have consumed a permit.
    storageMock.uploadObject.mockImplementation(async (_body: Buffer, key: string) => key)
    const recovered = await uploadFrameosMaterial(request(makeFile()), session, verifiedProject)
    expect(recovered.status).toBe(200)
  })

  it('rejects a form projectId that does not match the canvas route project', async () => {
    const form = new FormData()
    form.set('file', new File([Uint8Array.from(glbBuffer())], 'model.glb', { type: 'model/gltf-binary' }))
    form.set('title', '跨项目模型')
    form.set('projectId', 'someone-elses-project')
    const mismatched = new NextRequest('http://localhost/api/frameos/materials', { method: 'POST', body: form })

    await expect(uploadFrameosMaterial(mismatched, session, verifiedProject)).rejects.toMatchObject({
      code: 'INVALID_PARAMS',
      message: '上传素材的项目与当前画布不一致。',
    })
    expect(storageMock.uploadObject).not.toHaveBeenCalled()
    expect(registerMaterialMock).not.toHaveBeenCalled()
  })

  it('releases the permit after a validation failure', async () => {
    const invalid = request(new File(['{"asset":{"version":"2.0"}}'], 'external.gltf', { type: 'model/gltf+json' }))
    await expect(uploadFrameosMaterial(invalid, session, verifiedProject)).rejects.toMatchObject({
      code: 'INVALID_PARAMS',
    })

    const valid = request(new File([Uint8Array.from(glbBuffer())], 'model.glb', { type: 'model/gltf-binary' }))
    await expect(uploadFrameosMaterial(valid, session, verifiedProject)).resolves.toMatchObject({ status: 200 })
    expect(storageMock.uploadObject).toHaveBeenCalledTimes(1)
  })
})
