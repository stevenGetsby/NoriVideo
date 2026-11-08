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
const actor = vi.hoisted(() => ({ current: { workspaceOwnerId: 'owner', actorId: 'actor', isManagement: true, projectLeader: false, role: 'admin' } }))
const access = vi.hoisted(() => ({
  getWorkAccess: vi.fn(),
  requireWorkProjectCreator: vi.fn(),
  findHiddenProjectIds: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/collaboration/access', () => ({
  ...access,
  getWorkspaceActor: () => actor.current,
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
    actor.current = { workspaceOwnerId: 'owner', actorId: 'actor', isManagement: true, projectLeader: false, role: 'admin' }
    access.findHiddenProjectIds.mockResolvedValue(new Set())
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
    expect(db.work.create.mock.calls[0][0].data).toMatchObject({ name: '夜长安', workspaceOwnerId: 'owner', createdById: 'actor', members: { create: [{ userId: 'actor', role: 'member', canManage: false }] } })
    expect(db.novelPromotionProject.create).toHaveBeenCalledWith({ data: { projectId: 'p-new', videoRatio: '16:9', videoResolution: '4K' } })
    expect(db.canvasNode.create.mock.calls[0][0].data).toMatchObject({ canvasId: 'cv-new', type: 'story_entry' })
    const saved = db.interactiveStory.create.mock.calls[0][0].data
    expect(saved.config.start).toEqual({ projectId: 'p-new', entryNodeId: 'entry-new' })
    expect(saved.config.chapters).toEqual([{ projectId: 'p-new', order: 0, position: { x: 0, y: 0 }, status: 'drafting' }])
  })

  it('allows workspace leaders but rejects ordinary members before creating any story rows', async () => {
    actor.current = { ...actor.current, isManagement: false, projectLeader: false, role: 'writer' }
    await expect(createInteractiveStory(session, { name: '禁止立项' })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(db.$transaction).not.toHaveBeenCalled()
    expect(db.work.create).not.toHaveBeenCalled()

    actor.current = { ...actor.current, projectLeader: true }
    db.work.create.mockResolvedValue({ id: 'w-leader', name: '组长影游' })
    seedChapterRows()
    await expect(createInteractiveStory(session, { name: '组长影游' })).resolves.toMatchObject({ workId: 'w-leader' })
    expect(db.work.create.mock.calls[0][0].data.members.create).toEqual([{ userId: 'actor', role: 'member', canManage: false }])
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

  it('derives a work sequence for configs saved before the work canvas existed', async () => {
    seedChapterGraph()
    const result = await getInteractiveStory(session, 'w1')
    expect(result.story.config.sequence?.segments.map((segment) => [segment.projectId, segment.sceneNodeId, segment.branch, segment.removed])).toEqual([
      ['p1', 's1', false, false],
      ['p1', 's2', true, false],
    ])
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

const segment = (id: string, projectId: string, sceneNodeId: string, branch = false, removed = false) =>
  ({ id, projectId, sceneNodeId, title: '片段', branch, removed })
const link = (id: string, fromProjectId: string, exitNodeId: string, toProjectId: string, toEntryNodeId: string) =>
  ({ id, fromProjectId, exitNodeId, toProjectId, toEntryNodeId })

function seedChapterGraph() {
  db.project.findMany.mockResolvedValue([{
    id: 'p1', name: '第一章', updatedAt: new Date('2026-10-01'),
    canvases: [{
      id: 'cv1', updatedAt: new Date('2026-10-02'),
      nodes: [
        { id: 'in', type: 'story_entry', data: {}, status: 'IDLE' },
        { id: 's1', type: 'story_scene', data: { title: '城头' }, status: 'IDLE' },
        { id: 's2', type: 'story_scene', data: { title: '支线' }, status: 'IDLE' },
        { id: 'out', type: 'story_exit', data: {}, status: 'IDLE' },
      ],
      edges: [
        { id: 'e1', sourceNodeId: 'in', targetNodeId: 's1', sourceHandle: 'output', role: 'STORY_FLOW' },
        { id: 'e2', sourceNodeId: 's1', targetNodeId: 'out', sourceHandle: 'output', role: 'STORY_FLOW' },
      ],
    }],
  }])
}

describe('interactive story patch guards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    access.findHiddenProjectIds.mockResolvedValue(new Set())
    access.getWorkAccess.mockResolvedValue({ work: { id: 'w1', name: '长安', projects: [{ id: 'p1' }, { id: 'p2' }] }, canManage: true, canCreateProjects: true })
    db.interactiveStory.findUnique.mockResolvedValue({
      id: 's1', workId: 'w1', aspectRatio: '16:9', resolution: '720p',
      config: { variables: [], chapters: [{ projectId: 'p1', order: 0, position: { x: 0, y: 0 } }], links: [], start: { projectId: 'p1', entryNodeId: 'in' } },
    })
  })

  it('rejects references outside the work and hidden chapters', async () => {
    await expect(updateInteractiveStory(session, 'w1', { config: { sequence: { segments: [segment('s1', 'p9', 'in')] } } }))
      .rejects.toThrow('作品片段不属于该影游。')
    await expect(updateInteractiveStory(session, 'w1', { config: { chapters: [{ projectId: 'p1' }, { projectId: 'p9' }] } }))
      .rejects.toThrow('章节不属于该影游。')
    access.findHiddenProjectIds.mockResolvedValue(new Set(['p2']))
    await expect(updateInteractiveStory(session, 'w1', { config: { chapters: [{ projectId: 'p1' }, { projectId: 'p2' }] } }))
      .rejects.toThrow('故事配置引用了无权访问的作品。')
    expect(db.interactiveStory.update).not.toHaveBeenCalled()
  })

  it('rejects chapter link cycles, missing exits and missing start entries', async () => {
    await expect(updateInteractiveStory(session, 'w1', { config: { links: [
      link('l1', 'p1', 'in', 'p2', 'in'), link('l2', 'p2', 'in', 'p1', 'in'),
    ] } })).rejects.toThrow('章节连线形成了循环')
    seedChapterGraph()
    await expect(updateInteractiveStory(session, 'w1', { config: { links: [link('l1', 'p1', 'gone', 'p2', 'in')] } }))
      .rejects.toThrow('章节连线指向了已删除的出口。')
    await expect(updateInteractiveStory(session, 'w1', { config: { links: [link('l1', 'p1', 'out', 'p2', 'gone')] } }))
      .rejects.toThrow('章节连线指向了已删除的入口。')
    await expect(updateInteractiveStory(session, 'w1', { config: { start: { projectId: 'p1', entryNodeId: 'gone' } } }))
      .rejects.toThrow('故事起点指向的入口已被删除。')
    expect(db.interactiveStory.update).not.toHaveBeenCalled()
  })

  it('rejects a newly added orphan segment but lets a stored orphan be reordered and removed', async () => {
    seedChapterGraph()
    await expect(updateInteractiveStory(session, 'w1', { config: { sequence: { segments: [segment('new', 'p1', 'gone')] } } }))
      .rejects.toThrow('作品片段指向了已删除的剧情片段。')

    db.interactiveStory.findUnique.mockResolvedValue({
      id: 's1', workId: 'w1', aspectRatio: '16:9', resolution: '720p',
      config: {
        variables: [],
        chapters: [{ projectId: 'p1', order: 0, position: { x: 0, y: 0 } }],
        links: [], start: { projectId: 'p1', entryNodeId: 'in' },
        sequence: { segments: [segment('lost', 'p1', 'gone'), segment('s1', 'p1', 's1')] },
      },
    })
    await updateInteractiveStory(session, 'w1', { config: { sequence: { segments: [segment('s1', 'p1', 's1'), segment('lost', 'p1', 'gone', false, true)] } } })
    const saved = db.interactiveStory.update.mock.calls[0][0].data.config.sequence
    expect(saved.segments.map((item: { id: string; removed: boolean; branch: boolean }) => [item.id, item.removed, item.branch]))
      .toEqual([['s1', false, false], ['lost', true, false], ['seg_p1_s2', false, true]])
  })

  it('recomputes branch flags from the live graph so clients cannot promote a branch scene', async () => {
    seedChapterGraph()
    await updateInteractiveStory(session, 'w1', { config: { sequence: { segments: [
      segment('a', 'p1', 's1'), segment('b', 'p1', 's2'),
    ] } } })
    const saved = db.interactiveStory.update.mock.calls[0][0].data.config.sequence
    expect(saved.segments.map((item: { sceneNodeId: string; branch: boolean; title: string }) => [item.sceneNodeId, item.branch, item.title]))
      .toEqual([['s1', false, '城头'], ['s2', true, '支线']])
  })

  it('refuses patching when the actor has no access to the work', async () => {
    access.getWorkAccess.mockRejectedValue(new Error('无权访问该作品。'))
    await expect(updateInteractiveStory(session, 'w1', { config: { variables: [] } })).rejects.toThrow('无权访问该作品。')
    expect(db.interactiveStory.update).not.toHaveBeenCalled()
  })
})
