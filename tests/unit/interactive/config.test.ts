import { describe, expect, it } from 'vitest'
import { normalizeStoryConfig, parseStoryConfigInput, reconcileStoryChapters } from '@/lib/interactive/config'
import { compileChapter } from '@/lib/interactive/compile'

describe('interactive story config', () => {
  it('normalizes stored configs tolerantly', () => {
    const config = normalizeStoryConfig({
      variables: [
        { id: 'hp', name: ' 体力 ', type: 'number', initial: 'x' },
        { id: 'hp', name: '重复', type: 'number', initial: 1 },
        { id: 'flag', name: '开关', type: 'boolean', initial: true },
        { id: 'bad id', name: '坏', type: 'number' },
        { id: 'str', name: '文本', type: 'string' },
      ],
      chapters: [{ projectId: 'p1', status: 'final' }, { projectId: 'p1' }, { projectId: 'p2', status: '??', position: { x: 5, y: 6 } }],
      links: [
        { id: 'l1', fromProjectId: 'p1', exitNodeId: 'e', toProjectId: 'p2', toEntryNodeId: 'n' },
        { id: 'l2', fromProjectId: 'p1', exitNodeId: 'e', toProjectId: 'p2', toEntryNodeId: 'm' },
        { id: 'l3', fromProjectId: 'p1' },
      ],
      start: { projectId: 'p1', entryNodeId: 'n0' },
    })
    expect(config.variables).toEqual([
      { id: 'hp', name: '体力', type: 'number', initial: 0 },
      { id: 'flag', name: '开关', type: 'boolean', initial: true },
    ])
    expect(config.chapters).toEqual([
      { projectId: 'p1', order: 0, position: { x: 0, y: 0 }, status: 'final' },
      { projectId: 'p2', order: 2, position: { x: 5, y: 6 }, status: 'drafting' },
    ])
    expect(config.links.map((link) => link.id)).toEqual(['l1'])
    expect(config.start).toEqual({ projectId: 'p1', entryNodeId: 'n0' })
    expect(normalizeStoryConfig(null)).toEqual({ version: 1, variables: [], chapters: [], links: [], start: null })
  })

  it('rejects invalid client input with a readable message', () => {
    expect(parseStoryConfigInput('x')).toEqual({ ok: false, message: '故事配置格式错误。' })
    expect(parseStoryConfigInput({ variables: [{ id: 'a', name: '甲', type: 'number' }, { id: 'b', name: '甲', type: 'boolean' }] }))
      .toEqual({ ok: false, message: '全局变量「甲」重名。' })
    expect(parseStoryConfigInput({ variables: [{ id: 'a', name: '', type: 'number' }] }).ok).toBe(false)
    expect(parseStoryConfigInput({ links: [
      { id: 'l1', fromProjectId: 'p1', exitNodeId: 'e', toProjectId: 'p2', toEntryNodeId: 'n' },
      { id: 'l2', fromProjectId: 'p1', exitNodeId: 'e', toProjectId: 'p3', toEntryNodeId: 'n' },
    ] })).toEqual({ ok: false, message: '同一个出口只能连接一个下一章入口。' })
    expect(parseStoryConfigInput({ start: { projectId: 'p1' } }).ok).toBe(false)
    expect(parseStoryConfigInput({ variables: [{ id: 'a', name: '甲', type: 'boolean', initial: true }] })).toMatchObject({ ok: true })
  })

  it('reconciles chapters with the 作品 that still exist', () => {
    const config = normalizeStoryConfig({
      chapters: [{ projectId: 'gone', order: 0 }, { projectId: 'p2', order: 1, status: 'review' }],
      links: [{ id: 'l1', fromProjectId: 'gone', exitNodeId: 'e', toProjectId: 'p2', toEntryNodeId: 'n' }],
      start: { projectId: 'gone', entryNodeId: 'n' },
    })
    const next = reconcileStoryChapters(config, ['p2', 'p3'])
    expect(next.chapters.map((chapter) => [chapter.projectId, chapter.order, chapter.status])).toEqual([['p2', 0, 'review'], ['p3', 1, 'drafting']])
    expect(next.links).toEqual([])
    expect(next.start).toBeNull()
  })
})

describe('chapter compilation', () => {
  it('keeps story nodes, story flows and resolves scene media', () => {
    const chapter = compileChapter({ projectId: 'p1', title: '一' }, [
      { id: 's', type: 'story_scene', data: {} },
      { id: 'own', type: 'story_scene', data: { videoUrl: '/own.mp4', imageUrl: '/own.png' } },
      { id: 'img', type: 'image', data: { contentUrl: '/i.png' } },
      { id: 'vid', type: 'production_video', data: { videoUrl: '/v.mp4', imageUrl: '/v.png' } },
      { id: 'text', type: 'text', data: {} },
      { id: 'pick', type: 'story_choice', data: { options: [{ id: 'o' }], defaultOptionId: 'missing', timeoutSec: 999 } },
    ], [
      { id: 'r1', source: 'img', target: 's', role: 'REF' },
      { id: 'r2', source: 'vid', target: 's', role: 'REF' },
      { id: 'f1', source: 's', target: 'pick', sourceHandle: null, role: 'STORY_FLOW' },
      { id: 'f2', source: 'text', target: 's', role: 'STORY_FLOW' },
    ])
    expect(chapter.nodes.map((node) => node.id)).toEqual(['s', 'own', 'pick'])
    expect(chapter.nodes[0]).toMatchObject({ title: '剧情片段', media: { kind: 'video', url: '/v.mp4', posterUrl: '/v.png' } })
    expect(chapter.nodes[1]).toMatchObject({ media: { kind: 'video', url: '/own.mp4', posterUrl: '/own.png' } })
    expect(chapter.nodes[2]).toMatchObject({ timeoutSec: 120, defaultOptionId: null, options: [{ id: 'o', label: '', effects: [] }] })
    expect(chapter.flows).toEqual([{ id: 'f1', from: 's', handle: 'output', to: 'pick' }])
  })
})
