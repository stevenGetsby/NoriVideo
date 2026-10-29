import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthSession } from '@/lib/api-auth'

const db = vi.hoisted(() => {
  const model = () => ({ create: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() })
  const client = {
    work: model(), interactiveStory: model(), project: model(), novelPromotionProject: model(), canvas: model(), canvasNode: model(),
    $transaction: vi.fn(),
  }
  client.$transaction.mockImplementation((fn: (tx: typeof client) => unknown) => fn(client))
  return client
})
const access = vi.hoisted(() => ({
  getWorkAccess: vi.fn(),
  requireWorkProjectCreator: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/collaboration/access', () => ({
  ...access,
  getWorkspaceActor: () => ({ workspaceOwnerId: 'owner', actorId: 'actor', isManagement: true, role: 'admin' }),
  projectReadScopeWhere: () => ({ userId: 'owner', deletedAt: null }),
  workReadScopeWhere: () => ({ workspaceOwnerId: 'owner' }),
}))

import { createInteractiveChapter, createInteractiveStory, findInteractiveStoryByProject, getInteractiveStory, updateInteractiveStory } from '@/lib/interactive/service'

const session = { user: { id: 'actor', role: 'admin' } } as unknown as AuthSession

function seedChapterRows() {
  db.project.create.mockResolvedValue({ id: 'p-new', name: '第 1 章' })
  db.canvas.create.mockResolvedValue({ id: 'cv-new' })
  db.canvasNode.create.mockResolvedValue({ id: 'entry-new' })
}

describe('interactive story service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    access.getWorkAccess.mockResolvedValue({ work: { id: 'w1', name: '长安', projects: [{ id: 'p1' }, { id: 'p2' }] }, canManage: true, canCreateProjects: true })
    db.interactiveStory.findUnique.mockResolvedValue({
      id: 's1', workId: 'w1', aspectRatio: '16:9', resolution: '720p',
      config: { variables: [], chapters: [{ projectId: 'p1', order: 0, position: { x: 0, y: 0 } }], links: [], start: { projectId: 'p1', entryNodeId: 'n1' } },
    })
  })

  it('creates the project, its first chapter canvas with an entry node and the story start', async () => {
    db.work.create.mockResolvedValue({ id: 'w-new', name: '夜长安' })
    seedChapterRows()
    const story = await createInteractiveStory(session, { name: ' 夜长安 ', aspectRatio: '16:9', resolution: '4K' })

    expect(story).toMatchObject({ workId: 'w-new', aspectRatio: '16:9', resolution: '4K', firstChapter: { projectId: 'p-new', canvasId: 'cv-new', entryNodeId: 'entry-new' } })
    expect(db.work.create.mock.calls[0][0].data).toMatchObject({ name: '夜长安', workspaceOwnerId: 'owner', createdById: 'actor' })
    expect(db.novelPromotionProject.create).toHaveBeenCalledWith({ data: { projectId: 'p-new', videoRatio: '16:9', videoResolution: '4K' } })
    expect(db.canvasNode.create.mock.calls[0][0].data).toMatchObject({ canvasId: 'cv-new', type: 'story_entry' })
    const saved = db.interactiveStory.create.mock.calls[0][0].data
    expect(saved.config.start).toEqual({ projectId: 'p-new', entryNodeId: 'entry-new' })
    expect(saved.config.chapters).toEqual([{ projectId: 'p-new', order: 0, position: { x: 0, y: 0 }, status: 'drafting' }])
  })

  it('validates the name and the frame format', async () => {
    await expect(createInteractiveStory(session, { name: '  ' })).rejects.toThrow('请输入影游名称。')
    await expect(createInteractiveStory(session, { name: '甲', aspectRatio: '4:3' })).rejects.toThrow('画幅只能是 9:16 或 16:9。')
    await expect(createInteractiveStory(session, { name: '甲', resolution: '8K' })).rejects.toThrow('分辨率只能是')
    expect(db.work.create).not.toHaveBeenCalled()
  })

  it('returns 404 for a project that is not an interactive story', async () => {
    db.interactiveStory.findUnique.mockResolvedValue(null)
    await expect(getInteractiveStory(session, 'w1')).rejects.toThrow('影游项目不存在。')
  })

  it('compiles visible chapters and reconciles the stored config', async () => {
    db.project.findMany.mockResolvedValue([{
      id: 'p1', name: '第一章', updatedAt: new Date('2026-10-01'),
      canvases: [{
        id: 'cv1', updatedAt: new Date('2026-10-02'),
        nodes: [{ id: 'n1', type: 'story_entry', data: {}, status: 'IDLE' }, { id: 'v', type: 'video', data: {}, status: 'RUNNING' }],
        edges: [],
      }],
    }])
    const result = await getInteractiveStory(session, 'w1')
    expect(result.story).toMatchObject({ name: '长安', aspectRatio: '16:9', canManage: true })
    expect(result.story.config.chapters.map((chapter) => chapter.projectId)).toEqual(['p1', 'p2'])
    expect(result.chapters[0]).toMatchObject({ canvasId: 'cv1', nodeCount: 2, runningCount: 1, updatedAt: '2026-10-02T00:00:00.000Z' })
    expect(result.chapters[0].graph.nodes).toEqual([{ id: 'n1', kind: 'entry', title: '入口' }])
  })

  it('rejects invalid config input and syncs frame format to every chapter', async () => {
    await expect(updateInteractiveStory(session, 'w1', { config: { variables: [{ id: 'a', name: '', type: 'number' }] } }))
      .rejects.toThrow('全局变量需要合法的 ID、名称和类型。')
    db.project.findMany.mockResolvedValue([])
    await updateInteractiveStory(session, 'w1', { aspectRatio: '9:16', config: { variables: [{ id: 'hp', name: '体力', type: 'number', initial: 3 }], chapters: [] } })
    const data = db.interactiveStory.update.mock.calls[0][0].data
    expect(data.aspectRatio).toBe('9:16')
    expect(data.config.variables).toEqual([{ id: 'hp', name: '体力', type: 'number', initial: 3 }])
    expect(data.config.chapters.map((chapter: { projectId: string }) => chapter.projectId)).toEqual(['p1', 'p2'])
    expect(db.novelPromotionProject.updateMany).toHaveBeenCalledWith({ where: { projectId: { in: ['p1', 'p2'] } }, data: { videoRatio: '9:16' } })
  })

  it('keeps stored config keys the patch leaves out', async () => {
    db.interactiveStory.findUnique.mockResolvedValue({
      id: 's1', workId: 'w1', aspectRatio: '16:9', resolution: '720p',
      config: { chapters: [{ projectId: 'p1', order: 0 }, { projectId: 'p2', order: 1 }], links: [{ id: 'l1', fromProjectId: 'p1', exitNodeId: 'e', toProjectId: 'p2', toEntryNodeId: 'n' }], start: { projectId: 'p1', entryNodeId: 'n1' } },
    })
    db.project.findMany.mockResolvedValue([])
    await updateInteractiveStory(session, 'w1', { config: { variables: [{ id: 'hp', name: '体力', type: 'number', initial: 1 }] } })
    const data = db.interactiveStory.update.mock.calls[0][0].data
    expect(data.config.links.map((link: { id: string }) => link.id)).toEqual(['l1'])
    expect(data.config.start).toEqual({ projectId: 'p1', entryNodeId: 'n1' })
    expect(data.config.variables).toHaveLength(1)
  })

  it('finds the story of a chapter and returns null for ordinary 作品', async () => {
    db.project.findFirst.mockResolvedValueOnce(null)
    expect(await findInteractiveStoryByProject(session, 'gone')).toBeNull()
    db.project.findFirst.mockResolvedValue({ workId: 'w1' })
    db.interactiveStory.findUnique.mockResolvedValueOnce(null)
    expect(await findInteractiveStoryByProject(session, 'plain')).toBeNull()
    db.project.findMany.mockResolvedValue([{ id: 'p1', name: '第一章' }])
    const story = await findInteractiveStoryByProject(session, 'p1')
    expect(story).toMatchObject({ workId: 'w1', name: '长安', aspectRatio: '16:9', canManage: true, chapters: [{ projectId: 'p1', name: '第一章' }] })
    expect(story?.config.start).toEqual({ projectId: 'p1', entryNodeId: 'n1' })
  })

  it('only lets managers rename the project', async () => {
    access.getWorkAccess.mockResolvedValue({ work: { id: 'w1', name: '长安', projects: [] }, canManage: false, canCreateProjects: true })
    await expect(updateInteractiveStory(session, 'w1', { name: '新名' })).rejects.toThrow('当前账号没有管理该项目的权限。')
  })

  it('adds a chapter with the story format and places it after the last one', async () => {
    seedChapterRows()
    db.project.create.mockResolvedValue({ id: 'p3', name: '第 3 章' })
    const chapter = await createInteractiveChapter(session, 'w1', {})
    expect(access.requireWorkProjectCreator).toHaveBeenCalledWith(session, 'w1')
    expect(chapter).toMatchObject({ projectId: 'p3', name: '第 3 章' })
    expect(db.project.create.mock.calls[0][0].data.name).toBe('第 3 章')
    expect(db.novelPromotionProject.create).toHaveBeenCalledWith({ data: { projectId: 'p3', videoRatio: '16:9', videoResolution: '720p' } })
    const config = db.interactiveStory.update.mock.calls[0][0].data.config
    expect(config.chapters.map((item: { projectId: string; position: { x: number } }) => [item.projectId, item.position.x])).toEqual([['p1', 0], ['p2', 340], ['p3', 680]])
    expect(config.start).toEqual({ projectId: 'p1', entryNodeId: 'n1' })
  })
})
