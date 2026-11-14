import { describe, expect, it } from 'vitest'
import {
  STORY_SEQUENCE_SEGMENT_LIMIT,
  findStoryLinkCycle,
  normalizeStoryConfig,
  parseStoryConfigInput,
  reconcileStoryChapters,
} from '@/lib/interactive/config'
import { compileChapter } from '@/lib/interactive/compile'
import { validateSequence } from '@/lib/interactive/validate'

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

const segment = (id: string, projectId: string, sceneNodeId: string) =>
  ({ id, projectId, sceneNodeId, title: '片段', branch: false, removed: false })

describe('story sequence config', () => {
  it('tolerantly normalizes stored segments and drops duplicates', () => {
    const config = normalizeStoryConfig({
      sequence: {
        segments: [
          { id: 's1', projectId: 'p1', sceneNodeId: 'n1', title: ' 一 ', branch: true, removed: true },
          { id: 's1', projectId: 'p1', sceneNodeId: 'n1', title: '重复 ID' },
          { id: 's2', projectId: 'p1', sceneNodeId: 'n1', title: '重复片段' },
          { id: 's3', projectId: 'p1', sceneNodeId: 'n2' },
          { id: 'bad id', projectId: 'p1', sceneNodeId: 'n3' },
          { id: 's4', projectId: '', sceneNodeId: 'n4' },
          'not-a-segment',
        ],
      },
    })
    expect(config.sequence?.segments).toEqual([
      { id: 's1', projectId: 'p1', sceneNodeId: 'n1', title: '一', branch: true, removed: true },
      { id: 's3', projectId: 'p1', sceneNodeId: 'n2', title: '', branch: false, removed: false },
    ])
    expect(normalizeStoryConfig({ sequence: { segments: 'x' } }).sequence).toBeUndefined()
    expect(normalizeStoryConfig({ sequence: null }).sequence).toBeUndefined()
  })

  it('rejects malformed client sequence patches instead of dropping them', () => {
    expect(parseStoryConfigInput({ sequence: [] })).toEqual({ ok: false, message: '作品片段配置格式错误。' })
    expect(parseStoryConfigInput({ sequence: { segments: [segment('s1', 'p1', 'n1'), segment('s1', 'p1', 'n2')] } }))
      .toEqual({ ok: false, message: '作品片段 ID 重复。' })
    expect(parseStoryConfigInput({ sequence: { segments: [segment('s1', 'p1', 'n1'), segment('s2', 'p1', 'n1')] } }))
      .toEqual({ ok: false, message: '同一个剧情片段只能关联一个作品片段。' })
    expect(parseStoryConfigInput({ sequence: { segments: [{ id: 's1', projectId: 'p1' }] } }))
      .toEqual({ ok: false, message: '作品片段缺少合法的 ID、章节或剧情片段。' })
    const tooMany = Array.from({ length: STORY_SEQUENCE_SEGMENT_LIMIT + 1 }, (_item, index) => segment(`s${index}`, 'p1', `n${index}`))
    expect(parseStoryConfigInput({ sequence: { segments: tooMany } }))
      .toEqual({ ok: false, message: `作品片段最多 ${STORY_SEQUENCE_SEGMENT_LIMIT} 个。` })
    expect(parseStoryConfigInput({ sequence: { segments: [segment('s1', 'p1', 'n1')] } })).toMatchObject({ ok: true })
  })

  it('rejects duplicate chapters, duplicate link ids and reads cycles for story validation', () => {
    expect(parseStoryConfigInput({ chapters: [{ projectId: 'p1' }, { projectId: 'p1' }] }))
      .toEqual({ ok: false, message: '章节重复。' })
    expect(parseStoryConfigInput({ chapters: 'x' })).toEqual({ ok: false, message: '章节配置格式错误。' })
    expect(parseStoryConfigInput({ links: [
      { id: 'l1', fromProjectId: 'p1', exitNodeId: 'e', toProjectId: 'p2', toEntryNodeId: 'n' },
      { id: 'l1', fromProjectId: 'p2', exitNodeId: 'f', toProjectId: 'p3', toEntryNodeId: 'm' },
    ] })).toEqual({ ok: false, message: '章节连线 ID 重复。' })
    expect(parseStoryConfigInput({ links: [
      { id: 'l1', fromProjectId: 'p1', exitNodeId: 'e', toProjectId: 'p2', toEntryNodeId: 'n' },
      { id: 'l2', fromProjectId: 'p2', exitNodeId: 'f', toProjectId: 'p1', toEntryNodeId: 'm' },
    ] })).toMatchObject({ ok: true })
    expect(findStoryLinkCycle([
      { id: 'l1', fromProjectId: 'p1', exitNodeId: 'e', toProjectId: 'p2', toEntryNodeId: 'n' },
      { id: 'l2', fromProjectId: 'p2', exitNodeId: 'f', toProjectId: 'p3', toEntryNodeId: 'm' },
    ])).toBeNull()
    expect(findStoryLinkCycle([
      { id: 'l1', fromProjectId: 'p1', exitNodeId: 'e', toProjectId: 'p2', toEntryNodeId: 'n' },
      { id: 'l2', fromProjectId: 'p2', exitNodeId: 'f', toProjectId: 'p1', toEntryNodeId: 'm' },
    ])).toBe('p1')
  })

  it('reports orphaned sequence references against the live chapter graphs', () => {
    const chapter = compileChapter({ projectId: 'p1', title: '一' }, [
      { id: 'n1', type: 'story_scene', data: { title: '片段' } },
    ], [])
    const issues = validateSequence({ segments: [
      segment('s1', 'p1', 'n1'),
      segment('s2', 'gone', 'n'),
      segment('s3', 'p1', 'gone'),
      segment('s4', 'p1', 'n1'),
      segment('s1', 'p1', 'n2'),
    ] }, [chapter])
    expect(issues.map((item) => item.code)).toEqual(expect.arrayContaining(['segment_duplicate_id', 'segment_duplicate_scene', 'segment_orphan_project', 'segment_orphan_scene']))
    expect(issues.filter((item) => item.code === 'segment_orphan_project')[0]).toMatchObject({ level: 'error', projectId: 'gone' })
  })
})

describe('story variable presentation fields', () => {
  it('keeps icon, hud flag, cap and scope only when they are set', () => {
    const config = normalizeStoryConfig({
      variables: [
        { id: 'plain', name: '普通', type: 'number', initial: 2 },
        { id: 'coin', name: '金币', type: 'number', initial: 3, max: 10, icon: ' 🪙 ', showInHud: true, scope: 'permanent' },
        { id: 'flag', name: '开关', type: 'boolean', initial: true, icon: '/api/storage/sign?key=a', showInHud: true, scope: 'permanent', max: 4 },
        { id: 'weird', name: '怪', type: 'number', initial: 0, max: 'x', icon: 7, showInHud: 'yes', scope: 'run' },
        { id: 'long', name: '长图标', type: 'number', icon: 'x'.repeat(501) },
        { id: 'blank', name: '空图标', type: 'number', icon: '   ' },
      ],
    })
    expect(config.variables).toEqual([
      { id: 'plain', name: '普通', type: 'number', initial: 2 },
      { id: 'coin', name: '金币', type: 'number', initial: 3, max: 10, icon: '🪙', showInHud: true, scope: 'permanent' },
      { id: 'flag', name: '开关', type: 'boolean', initial: true, icon: '/api/storage/sign?key=a', showInHud: true, scope: 'permanent' },
      { id: 'weird', name: '怪', type: 'number', initial: 0 },
      { id: 'long', name: '长图标', type: 'number', initial: 0 },
      { id: 'blank', name: '空图标', type: 'number', initial: 0 },
    ])
    expect(Object.keys(config.variables[0]!)).toEqual(['id', 'name', 'type', 'initial'])
    expect(Object.keys(config.variables[3]!)).toEqual(['id', 'name', 'type', 'initial'])
  })

  it('round-trips a variable list through parse without growing keys', () => {
    const stored = [{ id: 'coin', name: '金币', type: 'number', initial: 3, max: 10, icon: '🪙', showInHud: true, scope: 'permanent' }, { id: 'k', name: '钥匙', type: 'number', initial: 0 }]
    const parsed = parseStoryConfigInput({ variables: stored })
    expect(parsed).toMatchObject({ ok: true })
    if (parsed.ok) expect(parsed.config.variables).toEqual(stored)
  })
})

describe('story shop config', () => {
  const item = (extra: Record<string, unknown> = {}) => ({ id: 'a', name: '钥匙', price: 5, effects: [{ variableId: 'key', op: 'add', value: 1 }], ...extra })

  it('is left out when the stored config has no shop', () => {
    expect('shop' in normalizeStoryConfig({ variables: [] })).toBe(false)
    expect('shop' in normalizeStoryConfig({ shop: 'x' })).toBe(false)
    expect('shop' in normalizeStoryConfig({ shop: null })).toBe(false)
    expect('shop' in normalizeStoryConfig({ shop: [] })).toBe(false)
  })

  it('reads an empty or half-written shop as a disabled one', () => {
    expect(normalizeStoryConfig({ shop: {} }).shop).toEqual({ enabled: false, currencyVariableId: null, items: [] })
    expect(normalizeStoryConfig({ shop: { enabled: 'yes', currencyVariableId: 'bad id', items: 'x' } }).shop)
      .toEqual({ enabled: false, currencyVariableId: null, items: [] })
    expect(normalizeStoryConfig({ shop: { enabled: true, currencyVariableId: 'coin' } }).shop)
      .toEqual({ enabled: true, currencyVariableId: 'coin', items: [] })
  })

  it('trims, rounds and clamps every item field', () => {
    const { shop } = normalizeStoryConfig({
      shop: {
        enabled: true,
        currencyVariableId: 'coin',
        items: [
          item({ id: 'a', name: ' 钥匙 ', icon: ' 🔑 ', description: ' 能开门 ', price: 5.678, limit: 2.6 }),
          item({ id: 'b', name: '免费', price: -3, limit: -1 }),
          item({ id: 'c', name: '天价', price: 5_000_000, limit: 500 }),
          item({ id: 'd', name: '缺省' }),
          item({ id: 'e', name: 'x'.repeat(40), description: 'y'.repeat(300), icon: 'z'.repeat(501), price: 'abc', limit: 'abc' }),
        ],
      },
    })
    expect(shop?.items).toEqual([
      { id: 'a', name: '钥匙', icon: '🔑', description: '能开门', price: 5.68, limit: 3, effects: [{ variableId: 'key', op: 'add', value: 1 }] },
      { id: 'b', name: '免费', icon: null, description: '', price: 0, limit: 0, effects: [{ variableId: 'key', op: 'add', value: 1 }] },
      { id: 'c', name: '天价', icon: null, description: '', price: 999_999, limit: 99, effects: [{ variableId: 'key', op: 'add', value: 1 }] },
      { id: 'd', name: '缺省', icon: null, description: '', price: 5, limit: 1, effects: [{ variableId: 'key', op: 'add', value: 1 }] },
      { id: 'e', name: 'x'.repeat(24), icon: null, description: 'y'.repeat(120), price: 0, limit: 1, effects: [{ variableId: 'key', op: 'add', value: 1 }] },
    ])
  })

  it('drops malformed items, duplicate ids and anything past the cap while normalizing', () => {
    const many = Array.from({ length: 40 }, (_unused, index) => item({ id: `i${index}`, name: `货${index}` }))
    expect(normalizeStoryConfig({ shop: { items: many } }).shop?.items).toHaveLength(30)
    const { shop } = normalizeStoryConfig({
      shop: { items: [item({ id: 'a' }), item({ id: 'a', name: '重复' }), item({ id: 'bad id' }), item({ id: 'n', name: '  ' }), 'nope', item({ id: 'ok', name: '好', effects: 'x' })] },
    })
    expect(shop?.items.map((entry) => entry.id)).toEqual(['a', 'ok'])
    expect(shop?.items[1]?.effects).toEqual([])
  })

  it('rejects malformed client shop patches instead of dropping them', () => {
    expect(parseStoryConfigInput({ shop: 'x' })).toEqual({ ok: false, message: '商城配置格式错误。' })
    expect(parseStoryConfigInput({ shop: [] })).toEqual({ ok: false, message: '商城配置格式错误。' })
    expect(parseStoryConfigInput({ shop: { items: 'x' } })).toEqual({ ok: false, message: '商城配置格式错误。' })
    expect(parseStoryConfigInput({ shop: { items: [{ id: 'a', price: 1 }] } })).toEqual({ ok: false, message: '商品需要合法的 ID 和名称。' })
    expect(parseStoryConfigInput({ shop: { items: [{ id: 'bad id', name: '甲' }] } })).toEqual({ ok: false, message: '商品需要合法的 ID 和名称。' })
    expect(parseStoryConfigInput({ shop: { items: [item({ id: 'a' }), item({ id: 'a', name: '乙' })] } })).toEqual({ ok: false, message: '商品 ID 重复。' })
    const tooMany = Array.from({ length: 31 }, (_unused, index) => item({ id: `i${index}`, name: `货${index}` }))
    expect(parseStoryConfigInput({ shop: { items: tooMany } })).toEqual({ ok: false, message: '商城商品最多 30 个。' })
  })

  it('accepts a clean shop, a missing shop and an explicit null', () => {
    const parsed = parseStoryConfigInput({ shop: { enabled: true, currencyVariableId: 'coin', items: [item()] } })
    expect(parsed).toMatchObject({ ok: true })
    if (parsed.ok) expect(parsed.config.shop).toEqual({ enabled: true, currencyVariableId: 'coin', items: [{ id: 'a', name: '钥匙', icon: null, description: '', price: 5, limit: 1, effects: [{ variableId: 'key', op: 'add', value: 1 }] }] })
    expect(parseStoryConfigInput({ shop: {} })).toMatchObject({ ok: true })
    const absent = parseStoryConfigInput({ variables: [] })
    expect(absent).toMatchObject({ ok: true })
    if (absent.ok) expect('shop' in absent.config).toBe(false)
    const nulled = parseStoryConfigInput({ shop: null })
    expect(nulled).toMatchObject({ ok: true })
    if (nulled.ok) expect('shop' in nulled.config).toBe(false)
  })

  it('keeps the shop through chapter reconciliation', () => {
    const config = normalizeStoryConfig({ chapters: [{ projectId: 'p1' }], shop: { enabled: true, currencyVariableId: 'coin', items: [item()] } })
    expect(reconcileStoryChapters(config, ['p1']).shop).toEqual(config.shop)
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
