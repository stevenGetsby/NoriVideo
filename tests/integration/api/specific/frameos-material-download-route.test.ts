import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../../helpers/request'
const mock = vi.hoisted(() => ({
  user: { findMany: vi.fn(), findUnique: vi.fn() },
  project: { findFirst: vi.fn(), findUnique: vi.fn() },
  novelPromotionProject: { findUnique: vi.fn() },
  frameosMaterial: { findFirst: vi.fn(), count: vi.fn() },
  frameosToolboxAsset: { findFirst: vi.fn(), count: vi.fn() },
}))
const read = vi.hoisted(() => vi.fn())
vi.mock('@/lib/prisma', () => ({ prisma: mock }))
vi.mock('@/lib/api-auth', () => ({
  requireUserAuth: async () => ({ session: { user: { id: 'owner', actorId: 'downloader', name: '下载者', role: 'admin', workspaceOwnerId: 'owner' } } }),
  isErrorResponse: (value: unknown) => value instanceof Response,
}))
vi.mock('@/lib/storage', () => ({ getObjectBuffer: read, extractStorageKey: (value: string) => value?.startsWith('video/') ? value : null }))
import { GET } from '@/app/api/frameos/materials/[materialId]/download/route'
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
    read.mockResolvedValue(Buffer.from('test-video'))
  })
  it('uses the parent project and generating creator, not the downloader name', async () => {
    const response = await GET(buildMockRequest({ path: '/api/frameos/materials/video-material/download', method: 'GET' }), context)
    expect(response.status).toBe(200)
    expect(decodeURIComponent(response.headers.get('x-nori-filename')!)).toBe('机甲三国_测试_视频001_马俊.mp4')
    expect(response.headers.get('content-disposition')).toContain("filename*=UTF-8''")
    expect(await response.text()).toBe('test-video')
  })
  it('never fetches storage when project access is denied', async () => {
    mock.project.findFirst.mockResolvedValueOnce(null)
    expect((await GET(buildMockRequest({ path: '/api/frameos/materials/video-material/download', method: 'GET' }), context)).status).toBe(404)
    expect(read).not.toHaveBeenCalled()
  })
  it('does not download deleted/inaccessible materials or arbitrary external URLs', async () => {
    mock.frameosMaterial.findFirst.mockResolvedValueOnce(null)
    expect((await GET(buildMockRequest({ path: '/api/frameos/materials/video-material/download', method: 'GET' }), context)).status).toBe(404)
    expect(read).not.toHaveBeenCalled()
  })
})
