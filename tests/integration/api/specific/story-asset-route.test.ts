import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { ApiError } from '@/lib/api-errors'

const authMock = vi.hoisted(() => ({
  requireUserPermission: vi.fn(),
  isErrorResponse: (value: unknown) => value instanceof NextResponse,
}))
const serviceMock = vi.hoisted(() => ({
  requireInteractiveStoryAccess: vi.fn(),
}))
const assetMock = vi.hoisted(() => ({
  prepareStoryAssetImage: vi.fn(),
  uploadStoryAssetObject: vi.fn(),
}))
const storageMock = vi.hoisted(() => ({
  getSignedUrl: vi.fn((key: string) => `/api/storage/sign?key=${encodeURIComponent(key)}&expires=3600`),
}))

vi.mock('@/lib/api-auth', () => authMock)
vi.mock('@/lib/interactive/service', () => serviceMock)
vi.mock('@/lib/interactive/story-asset', () => assetMock)
vi.mock('@/lib/storage', () => storageMock)

const prepared = { body: Buffer.from('webp'), extension: 'webp' as const, mimeType: 'image/webp' as const }
const key = 'images/interactive-work-1-1717000000-ab12.webp'
const routeContext = { params: Promise.resolve({ workId: 'work-1' }) }
const session = { user: { id: 'user-1' } }

function uploadRequest() {
  const form = new FormData()
  form.set('file', new File([Buffer.from('image')], 'button.png', { type: 'image/png' }))
  return new NextRequest('http://localhost/api/interactive/work-1/assets', { method: 'POST', body: form })
}

async function callPost(request = uploadRequest()) {
  const { POST } = await import('@/app/api/interactive/[workId]/assets/route')
  return POST(request as never, routeContext)
}

describe('影游图片上传 API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMock.requireUserPermission.mockResolvedValue({ session })
    serviceMock.requireInteractiveStoryAccess.mockResolvedValue({})
    assetMock.prepareStoryAssetImage.mockResolvedValue(prepared)
    assetMock.uploadStoryAssetObject.mockResolvedValue(key)
  })

  it('未登录或没有画布编辑权限时拒绝上传', async () => {
    authMock.requireUserPermission.mockResolvedValueOnce(
      NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED' } }, { status: 401 }),
    )

    const response = await callPost()

    expect(response.status).toBe(401)
    expect(authMock.requireUserPermission).toHaveBeenCalledWith(['canvasWrite'])
    expect(serviceMock.requireInteractiveStoryAccess).not.toHaveBeenCalled()
    expect(assetMock.prepareStoryAssetImage).not.toHaveBeenCalled()
  })

  it('不是该影游的成员时拒绝上传，且不处理图片', async () => {
    serviceMock.requireInteractiveStoryAccess.mockRejectedValueOnce(new ApiError('FORBIDDEN', { message: 'forbidden' }))

    const response = await callPost()

    expect(response.status).toBe(403)
    expect(serviceMock.requireInteractiveStoryAccess).toHaveBeenCalledWith(session, 'work-1')
    expect(assetMock.prepareStoryAssetImage).not.toHaveBeenCalled()
    expect(assetMock.uploadStoryAssetObject).not.toHaveBeenCalled()
  })

  it('作品不是影游时返回 404', async () => {
    serviceMock.requireInteractiveStoryAccess.mockRejectedValueOnce(new ApiError('NOT_FOUND', { message: '影游项目不存在。' }))

    const response = await callPost()

    expect(response.status).toBe(404)
    expect(assetMock.uploadStoryAssetObject).not.toHaveBeenCalled()
  })

  it('缺少文件时返回参数错误', async () => {
    const request = new NextRequest('http://localhost/api/interactive/work-1/assets', { method: 'POST', body: new FormData() })

    const response = await callPost(request)

    expect(response.status).toBe(400)
    expect((await response.json()).error.code).toBe('INVALID_PARAMS')
    expect(assetMock.prepareStoryAssetImage).not.toHaveBeenCalled()
  })

  it('图片校验失败时返回 400，且不写入存储', async () => {
    assetMock.prepareStoryAssetImage.mockRejectedValueOnce(
      new ApiError('INVALID_PARAMS', { code: 'STORY_ASSET_IMAGE_INVALID', message: '图片仅支持 PNG、JPG、WebP 或 GIF。' }),
    )

    const response = await callPost()

    expect(response.status).toBe(400)
    expect(assetMock.uploadStoryAssetObject).not.toHaveBeenCalled()
  })

  it('上传成功时按该影游的前缀写入并返回可存进节点的地址', async () => {
    const response = await callPost()

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      key,
      url: `/api/storage/sign?key=${encodeURIComponent(key)}&expires=3600`,
    })
    expect(assetMock.uploadStoryAssetObject).toHaveBeenCalledWith('work-1', prepared)
  })
})
