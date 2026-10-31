import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { ApiError } from '@/lib/api-errors'

const authMock = vi.hoisted(() => ({
  requireUserAuth: vi.fn(),
  isErrorResponse: (value: unknown) => value instanceof NextResponse,
}))
const accessMock = vi.hoisted(() => ({
  requireProjectManager: vi.fn(),
}))
const prismaMock = vi.hoisted(() => ({
  project: {
    updateMany: vi.fn(),
  },
}))
const coverImageMock = vi.hoisted(() => ({
  prepareProjectCoverImage: vi.fn(),
  uploadProjectCoverImage: vi.fn(),
  deleteProjectCoverObject: vi.fn(),
}))
const coverUrlMock = vi.hoisted(() => ({
  projectCoverImageUrl: vi.fn((key: string) => (key ? `https://signed.example.com/${key}` : null)),
}))

vi.mock('@/lib/api-auth', () => authMock)
vi.mock('@/lib/collaboration/access', async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  requireProjectManager: accessMock.requireProjectManager,
}))
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/projects/project-cover-image', () => coverImageMock)
vi.mock('@/lib/projects/project-cover-url', () => coverUrlMock)

const prepared = { body: Buffer.from('jpeg'), extension: 'jpg' as const, mimeType: 'image/jpeg' as const }
const nextKey = 'images/project-cover-project-1-1717000000-ab12.jpg'
const previousKey = 'images/project-cover-project-1-1600000000-old0.jpg'

function uploadRequest() {
  const form = new FormData()
  form.set('file', new File([Buffer.from('image')], 'cover.png', { type: 'image/png' }))
  return new NextRequest('http://localhost/api/projects/project-1/cover', {
    method: 'POST',
    body: form,
  })
}

function deleteRequest() {
  return new NextRequest('http://localhost/api/projects/project-1/cover', { method: 'DELETE' })
}

const routeContext = { params: Promise.resolve({ projectId: 'project-1' }) }

async function callPost(request = uploadRequest()) {
  const { POST } = await import('@/app/api/projects/[projectId]/cover/route')
  return POST(request as never, routeContext)
}

async function callDelete(request = deleteRequest()) {
  const { DELETE } = await import('@/app/api/projects/[projectId]/cover/route')
  return DELETE(request as never, routeContext)
}

function readerProject(coverImageKey: string | null) {
  return { id: 'project-1', userId: 'workspace-1', coverImageKey }
}

describe('项目封面 API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMock.requireUserAuth.mockResolvedValue({ session: { user: { id: 'workspace-1' } } })
    accessMock.requireProjectManager.mockResolvedValue({ project: readerProject(null) })
    prismaMock.project.updateMany.mockResolvedValue({ count: 1 })
    coverImageMock.prepareProjectCoverImage.mockResolvedValue(prepared)
    coverImageMock.uploadProjectCoverImage.mockResolvedValue(nextKey)
    coverImageMock.deleteProjectCoverObject.mockResolvedValue(undefined)
  })

  it('未登录时拒绝上传', async () => {
    authMock.requireUserAuth.mockResolvedValueOnce(
      NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED' } }, { status: 401 }),
    )

    const response = await callPost()

    expect(response.status).toBe(401)
    expect(coverImageMock.prepareProjectCoverImage).not.toHaveBeenCalled()
  })

  it('没有作品访问权限时拒绝上传', async () => {
    accessMock.requireProjectManager.mockRejectedValueOnce(new ApiError('FORBIDDEN', { message: 'forbidden' }))

    const response = await callPost()

    expect(response.status).toBe(403)
    expect(coverImageMock.uploadProjectCoverImage).not.toHaveBeenCalled()
  })

  it('缺少文件时返回参数错误', async () => {
    const request = new NextRequest('http://localhost/api/projects/project-1/cover', {
      method: 'POST',
      body: new FormData(),
    })

    const response = await callPost(request)

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error.code).toBe('INVALID_PARAMS')
    expect(coverImageMock.prepareProjectCoverImage).not.toHaveBeenCalled()
  })

  it('上传成功时返回签名地址并清理旧封面', async () => {
    const response = await callPost()

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      projectId: 'project-1',
      coverImageKey: nextKey,
      coverImageUrl: `https://signed.example.com/${nextKey}`,
    })
    expect(prismaMock.project.updateMany).toHaveBeenCalledWith({
      where: { id: 'project-1', userId: 'workspace-1', coverImageKey: null },
      data: { coverImageKey: nextKey },
    })
    expect(coverImageMock.deleteProjectCoverObject).toHaveBeenCalledWith(null)
  })

  it('替换封面时只清理已切换掉的旧对象', async () => {
    accessMock.requireProjectManager.mockResolvedValueOnce({ project: readerProject(previousKey) })
    prismaMock.project.updateMany.mockResolvedValueOnce({ count: 1 })

    const response = await callPost()

    expect(response.status).toBe(200)
    expect(prismaMock.project.updateMany).toHaveBeenCalledWith({
      where: { id: 'project-1', userId: 'workspace-1', coverImageKey: previousKey },
      data: { coverImageKey: nextKey },
    })
    expect(coverImageMock.deleteProjectCoverObject).toHaveBeenCalledWith(previousKey)
  })

  it('并发写入冲突时回滚刚上传的对象并返回 409', async () => {
    prismaMock.project.updateMany.mockResolvedValueOnce({ count: 0 })

    const response = await callPost()

    expect(response.status).toBe(409)
    const body = await response.json()
    expect(body.error.code).toBe('CONFLICT')
    expect(coverImageMock.deleteProjectCoverObject).toHaveBeenCalledTimes(1)
    expect(coverImageMock.deleteProjectCoverObject).toHaveBeenCalledWith(nextKey)
  })

  it('数据库异常时同样回滚新对象', async () => {
    prismaMock.project.updateMany.mockRejectedValueOnce(new Error('db down'))

    const response = await callPost()

    expect(response.status).toBe(500)
    expect(coverImageMock.deleteProjectCoverObject).toHaveBeenCalledWith(nextKey)
  })

  it('移除封面时清空字段并删除旧对象', async () => {
    accessMock.requireProjectManager.mockResolvedValueOnce({ project: readerProject(previousKey) })
    prismaMock.project.updateMany.mockResolvedValueOnce({ count: 1 })

    const response = await callDelete()

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      coverImageKey: null,
      coverImageUrl: null,
    })
    expect(prismaMock.project.updateMany).toHaveBeenCalledWith({
      where: { id: 'project-1', userId: 'workspace-1', coverImageKey: previousKey },
      data: { coverImageKey: null },
    })
    expect(coverImageMock.deleteProjectCoverObject).toHaveBeenCalledWith(previousKey)
  })

  it('没有封面时移除操作是幂等的', async () => {
    const response = await callDelete()

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ success: true, coverImageKey: null })
    expect(prismaMock.project.updateMany).not.toHaveBeenCalled()
    expect(coverImageMock.deleteProjectCoverObject).not.toHaveBeenCalled()
  })

  it('移除时并发冲突返回 409 且不删除对象', async () => {
    accessMock.requireProjectManager.mockResolvedValueOnce({ project: readerProject(previousKey) })
    prismaMock.project.updateMany.mockResolvedValueOnce({ count: 0 })

    const response = await callDelete()

    expect(response.status).toBe(409)
    expect(coverImageMock.deleteProjectCoverObject).not.toHaveBeenCalled()
  })
})
