import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../../helpers/request'
const mock = vi.hoisted(() => ({
  user: { findMany: vi.fn(), findUnique: vi.fn() },
  project: { findFirst: vi.fn(), findUnique: vi.fn() },
  novelPromotionProject: { findUnique: vi.fn() },
  frameosMaterial: { findFirst: vi.fn(), count: vi.fn() },
  frameosToolboxAsset: { findFirst: vi.fn(), count: vi.fn() },
}))
const sign = vi.hoisted(() => vi.fn())
vi.mock('@/lib/prisma', () => ({ prisma: mock }))
vi.mock('@/lib/api-auth', () => ({
  requireUserAuth: async () => ({ session: { user: { id: 'owner', actorId: 'downloader', name: '下载者', role: 'admin', workspaceOwnerId: 'owner' } } }),
  isErrorResponse: (value: unknown) => value instanceof Response,
}))
vi.mock('@/lib/storage', () => ({
  getSignedObjectUrl: sign,
  toFetchableUrl: (value: string) => value,
  extractStorageKey: (value: string) => value?.startsWith('video/') ? value : null,
}))
import { GET } from '@/app/api/frameos/materials/[materialId]/download/route'
const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)
const context = { params: Promise.resolve({ materialId: 'video-material' }) }
describe('named video downloads', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mock.user.findMany.mockResolvedValue([{ id: 'owner' }])
    mock.project.findFirst.mockResolvedValue({ id: 'project' })
    mock.project.findUnique.mockResolvedValue({ name: '第008集', work: { name: '机甲三国' } })
    mock.novelPromotionProject.findUnique.mockResolvedValue({ exportNamingTemplate: null })
    mock.frameosMaterial.count.mockResolvedValue(1)
    mock.frameosToolboxAsset.findFirst.mockResolvedValue(null)
    mock.frameosMaterial.findFirst.mockResolvedValue({ id: 'video-material', projectId: 'project', title: '测试', ownerName: '马俊', type: 'video', createdAt: new Date(), storageKey: 'video/test.mp4', metadata: {} })
    sign.mockResolvedValue('https://tos.example/video/test.mp4')
    fetchMock.mockResolvedValue(new Response('test-video', { status: 200, headers: { 'content-length': '10' } }))
  })
  it('streams the object with the parent project and generating creator name', async () => {
    const response = await GET(buildMockRequest({ path: '/api/frameos/materials/video-material/download', method: 'GET' }), context)
    expect(response.status).toBe(200)
    expect(decodeURIComponent(response.headers.get('x-nori-filename')!)).toBe('机甲三国_测试_视频001_马俊.mp4')
    expect(response.headers.get('content-disposition')).toContain("filename*=UTF-8''")
    expect(await response.text()).toBe('test-video')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it('returns a signed direct url in mode=url without proxying bytes', async () => {
    const response = await GET(buildMockRequest({ path: '/api/frameos/materials/video-material/download', method: 'GET', query: { mode: 'url' } }), context)
    expect(response.status).toBe(200)
    const payload = await response.json() as { url: string; filename: string }
    expect(payload.url).toBe('https://tos.example/video/test.mp4')
    expect(payload.filename).toBe('机甲三国_测试_视频001_马俊.mp4')
    expect(sign).toHaveBeenCalledWith('video/test.mp4', 600, expect.objectContaining({ responseContentDisposition: expect.stringContaining("filename*=UTF-8''") }))
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('downloads the generating actor\'s personal material without a project row', async () => {
    mock.frameosMaterial.findFirst.mockResolvedValueOnce({ id: 'video-material', projectId: 'personal', personalOwnerId: 'downloader', title: '首尾帧成片', ownerName: '下载者', type: 'video', createdAt: new Date(), storageKey: 'video/test.mp4', metadata: {} })
    const response = await GET(buildMockRequest({ path: '/api/frameos/materials/video-material/download', method: 'GET' }), context)
    expect(response.status).toBe(200)
    expect(mock.project.findFirst).not.toHaveBeenCalled()
    expect(await response.text()).toBe('test-video')
  })
  it('keeps another member\'s personal material inaccessible', async () => {
    mock.frameosMaterial.findFirst.mockResolvedValueOnce({ id: 'video-material', projectId: 'personal', personalOwnerId: 'other-member', title: '别人的成片', type: 'video', createdAt: new Date(), storageKey: 'video/test.mp4', metadata: {} })
    expect((await GET(buildMockRequest({ path: '/api/frameos/materials/video-material/download', method: 'GET' }), context)).status).toBe(404)
    expect(mock.project.findFirst).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(sign).not.toHaveBeenCalled()
  })
  it('never fetches storage when project access is denied', async () => {
    mock.project.findFirst.mockResolvedValueOnce(null)
    expect((await GET(buildMockRequest({ path: '/api/frameos/materials/video-material/download', method: 'GET' }), context)).status).toBe(404)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(sign).not.toHaveBeenCalled()
  })
  it('does not download deleted/inaccessible materials or arbitrary external URLs', async () => {
    mock.frameosMaterial.findFirst.mockResolvedValueOnce(null)
    expect((await GET(buildMockRequest({ path: '/api/frameos/materials/video-material/download', method: 'GET' }), context)).status).toBe(404)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(sign).not.toHaveBeenCalled()
  })
})
