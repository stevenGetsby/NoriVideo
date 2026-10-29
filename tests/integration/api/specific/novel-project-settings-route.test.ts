import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const authMock = vi.hoisted(() => ({
  requireProjectAuthLight: vi.fn(),
  isErrorResponse: (value: unknown) => value instanceof Response,
}))
const accessMock = vi.hoisted(() => ({
  requireProjectReader: vi.fn(),
}))
const prismaMock = vi.hoisted(() => ({
  novelPromotionProject: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  userPreference: {
    findUnique: vi.fn(),
  },
}))

vi.mock('@/lib/api-auth', () => authMock)
vi.mock('@/lib/collaboration/access', async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  requireProjectReader: accessMock.requireProjectReader,
}))
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/config-service', async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  getProjectModelConfig: vi.fn(async () => null),
}))
vi.mock('@/lib/media/attach', () => ({
  attachMediaFieldsToProject: vi.fn(async (project) => project),
}))
vi.mock('@/lib/logging/semantic', () => ({ logProjectAction: vi.fn() }))

function managerRequest(body: unknown) {
  return new NextRequest('http://localhost/api/novel-promotion/project-1', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

async function callPatch(body: unknown) {
  const { PATCH } = await import('@/app/api/novel-promotion/[projectId]/route')
  return PATCH(managerRequest(body) as never, {
    params: Promise.resolve({ projectId: 'project-1' }),
  })
}

describe('作品设置 API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMock.requireProjectAuthLight.mockResolvedValue({
      session: { user: { id: 'workspace-1', role: 'admin' } },
      project: { id: 'project-1', userId: 'workspace-1', name: 'Project 1' },
    })
    accessMock.requireProjectReader.mockResolvedValue({})
    prismaMock.novelPromotionProject.findUnique.mockResolvedValue({
      analysisModel: null,
      characterModel: null,
      locationModel: null,
      storyboardModel: null,
      editModel: null,
      videoModel: null,
      audioModel: null,
      projectStyle: 'live-action',
      artStylePrompt: null,
    })
    prismaMock.userPreference.findUnique.mockResolvedValue(null)
    prismaMock.novelPromotionProject.update.mockResolvedValue({ projectId: 'project-1' })
  })

  it('没有作品访问权限时不允许修改作品设置', async () => {
    accessMock.requireProjectReader.mockRejectedValueOnce(new Error('forbidden'))

    const response = await callPatch({ projectStyle: 'anime' })

    expect(response.status).toBe(403)
    expect(prismaMock.novelPromotionProject.update).not.toHaveBeenCalled()
  })

  it.each(['writer', 'asset', 'storyboard', 'reviewer'])('允许活跃作品参与人员 %s 修改设置但不能修改作品归属', async (role) => {
    authMock.requireProjectAuthLight.mockResolvedValueOnce({
      session: { user: { id: 'workspace-1', actorId: 'child-1', role } },
      project: { id: 'project-1', userId: 'workspace-1', name: 'Project 1' },
    })
    const response = await callPatch({ videoRatio: '16:9', userId: 'other-workspace', projectId: 'foreign' })
    expect(response.status).toBe(200)
    expect(accessMock.requireProjectReader).toHaveBeenCalledWith(expect.any(Object), 'project-1')
    expect(prismaMock.novelPromotionProject.update).toHaveBeenCalledWith({
      where: { projectId: 'project-1' }, data: { videoRatio: '16:9' },
    })
  })

  it('保存合法枚举和时长，并同步两个时长字段', async () => {
    const response = await callPatch({
      projectStyle: 'anime',
      targetAudience: 'global-platform',
      videoRatio: '16:9',
      videoResolution: '1080p',
      episodeDurationMode: 'per-1000-chars',
      episodeDurationValue: 30,
    })

    expect(response.status).toBe(200)
    expect(prismaMock.novelPromotionProject.update).toHaveBeenCalledWith({
      where: { projectId: 'project-1' },
      data: {
        projectStyle: 'anime',
        targetAudience: 'global-platform',
        videoRatio: '16:9',
        videoResolution: '1080p',
        episodeDurationMode: 'per-1000-chars',
        episodeDurationValue: 30,
        targetEpisodeDurationSeconds: 30,
      },
    })
  })

  it.each([
    ['projectStyle', 'unknown-style'],
    ['targetAudience', 'unknown-audience'],
    ['videoRatio', '4:3'],
    ['videoResolution', '8K'],
  ])('拒绝非法 %s', async (field, value) => {
    const response = await callPatch({ [field]: value })

    expect(response.status).toBe(400)
    expect(prismaMock.novelPromotionProject.update).not.toHaveBeenCalled()
  })

  it('自定义画风保存为最高优先级，且覆盖内置画风', async () => {
    await callPatch({ artStylePrompt: '水墨武侠，胶片颗粒' })

    const data = prismaMock.novelPromotionProject.update.mock.calls[0][0].data as { artStylePrompt: string }
    expect(data.artStylePrompt).toContain('【用户自定义画风（最高优先级）】')
    expect(data.artStylePrompt).toContain('水墨武侠，胶片颗粒')
    expect(data.artStylePrompt).toContain('用户自定义画风完全覆盖创建项目时选择的内置画风')
    expect(data.artStylePrompt).not.toContain('【Nori1.0 项目基础画风】')
  })

  it('清空自定义画风后恢复所选内置画风', async () => {
    await callPatch({ projectStyle: 'anime', artStylePrompt: '' })

    const data = prismaMock.novelPromotionProject.update.mock.calls[0][0].data as { artStylePrompt: string }
    expect(data.artStylePrompt).toContain('【Nori1.0 项目基础画风】')
    expect(data.artStylePrompt).toContain('高质量现代动漫短剧画风')
    expect(data.artStylePrompt).not.toContain('【用户自定义画风（最高优先级）】')
  })

  it('保存项目级导出命名模板和成员目录提示', async () => {
    const response = await callPatch({
      exportNamingTemplate: '{project}_{episode}_{sequence}_{creator}',
      exportDirectoryHint: 'D:\\LanmiaoTVDownloads\\机甲三国',
    })
    expect(response.status).toBe(200)
    expect(prismaMock.novelPromotionProject.update).toHaveBeenCalledWith({
      where: { projectId: 'project-1' },
      data: {
        exportNamingTemplate: '{project}_{episode}_{sequence}_{creator}',
        exportDirectoryHint: 'D:\\LanmiaoTVDownloads\\机甲三国',
      },
    })
  })
})
