import { describe, expect, it } from 'vitest'
import type { FrameosMaterialItem } from '@/components/frameos/materials/contracts'
import {
  buildInheritSourceOptions,
  clearInheritMaterials,
  countMaterialOrigins,
  defaultInheritSelection,
  filterInheritableMaterials,
  formatInheritUpdatedAt,
  inheritSourceLabel,
  inheritSourceSelectOptions,
  inheritSubmitIssue,
  isInheritableMaterial,
  isInheritIssueMessage,
  previousInheritSource,
  selectInheritMaterials,
  toggleInheritSelection,
  type InheritSourceOption,
} from '@/components/frameos/works/inherit-sources'
import type { WorkSummary } from '@/components/frameos/works/types'
import { INHERITED_FROM_KEY, MAX_INHERITED_MATERIALS } from '@/lib/frameos/material-inherit'

function work(id: string, name: string, projects: Array<{ id: string; name: string; updatedAt?: string; createdAt?: string }>): WorkSummary {
  return {
    id,
    name,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    projectCount: projects.length,
    projects: projects.map((project) => ({
      id: project.id,
      name: project.name,
      createdAt: project.createdAt ?? '2026-10-01T00:00:00.000Z',
      updatedAt: project.updatedAt ?? '2026-10-01T00:00:00.000Z',
    })),
  }
}

function material(id: string, overrides: Partial<FrameosMaterialItem> = {}): FrameosMaterialItem {
  return {
    id,
    projectId: 'project-a',
    projectName: '第一集',
    ownerName: '小王',
    title: `素材 ${id}`,
    type: 'image',
    source: 'creative',
    status: 'ready',
    isFavorited: false,
    resultUrl: `https://cdn.example/${id}.png`,
    storageKey: `k/${id}.png`,
    url: `https://cdn.example/${id}.png`,
    metadata: {},
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    ...overrides,
  }
}

const inherited = { [INHERITED_FROM_KEY]: { projectId: 'p0', projectName: '更早', materialId: 'm0' } }

describe('inherit source options', () => {
  const works = [
    work('work-1', '西游记', [
      { id: 'p-old', name: '第一集', updatedAt: '2026-10-02T00:00:00.000Z' },
      { id: 'p-new', name: '第二集', updatedAt: '2026-10-09T00:00:00.000Z' },
    ]),
    work('work-2', '三国', [
      { id: 'p-three', name: '桃园', updatedAt: '2026-10-20T00:00:00.000Z' },
    ]),
  ]

  it('lists the target 项目\'s own 作品 first, then the rest by most recent update', () => {
    const options = buildInheritSourceOptions(works, 'work-1')
    expect(options.map((option) => option.projectId)).toEqual(['p-new', 'p-old', 'p-three'])
    expect(buildInheritSourceOptions(works, 'work-2').map((option) => option.projectId)).toEqual(['p-three', 'p-new', 'p-old'])
    expect(buildInheritSourceOptions(works, 'work-none').map((option) => option.projectId)).toEqual(['p-three', 'p-new', 'p-old'])
  })

  it('carries both the 项目 and the 作品 names', () => {
    const [first] = buildInheritSourceOptions(works, 'work-1')
    expect(first).toMatchObject({ projectId: 'p-new', projectName: '第二集', workId: 'work-1', workName: '西游记' })
    expect(inheritSourceLabel(first)).toBe('西游记 / 第二集')
  })

  it('skips repeated and id-less 作品 and falls back to the creation time for the sort key', () => {
    const options = buildInheritSourceOptions([
      work('work-1', '甲', [{ id: 'dup', name: '一' }, { id: '', name: '无' }]),
      work('work-2', '乙', [{ id: 'dup', name: '重复' }, { id: 'fresh', name: '新', updatedAt: '', createdAt: '2026-12-01T00:00:00.000Z' }]),
    ], 'none')
    expect(options.map((option) => option.projectId)).toEqual(['fresh', 'dup'])
    expect(options.find((option) => option.projectId === 'dup')?.workName).toBe('甲')
    expect(buildInheritSourceOptions([], 'work-1')).toEqual([])
  })

  it('breaks full ties by name then id so the order never flickers', () => {
    const tied = [
      work('w', '项目', [
        { id: 'b-2', name: '乙' }, { id: 'b-1', name: '乙' }, { id: 'a-1', name: '甲' },
      ]),
    ]
    expect(buildInheritSourceOptions(tied, 'w').map((option) => option.projectId)).toEqual(['a-1', 'b-1', 'b-2'])
  })

  it('treats the most recently updated 作品 of the same 项目 as the previous one', () => {
    const options = buildInheritSourceOptions(works, 'work-1')
    expect(previousInheritSource(options, 'work-1')?.projectId).toBe('p-new')
    expect(previousInheritSource(options, 'work-2')?.projectId).toBe('p-three')
  })

  it('has no previous 作品 when the 项目 is empty or unknown, even if other 项目 have some', () => {
    const options = buildInheritSourceOptions(works, 'work-1')
    expect(previousInheritSource(options, 'work-9')).toBeNull()
    expect(previousInheritSource([], 'work-1')).toBeNull()
    expect(previousInheritSource(buildInheritSourceOptions([work('empty', '空', [])], 'empty'), 'empty')).toBeNull()
  })
})

describe('select labels', () => {
  const option = (projectId: string, projectName: string, workName: string, updatedAt = '2026-10-01T08:30:00.000Z'): InheritSourceOption => ({
    projectId, projectName, workId: `w-${workName}`, workName, updatedAt,
  })

  it('uses the plain label when every 作品 reads differently', () => {
    expect(inheritSourceSelectOptions([option('p1', '第一集', '西游记'), option('p2', '第二集', '西游记')])).toEqual([
      { value: 'p1', label: '西游记 / 第一集' },
      { value: 'p2', label: '西游记 / 第二集' },
    ])
  })

  it('adds the update time to same-named 作品 and an id tail when even that collides', () => {
    const labels = inheritSourceSelectOptions([
      option('p-0001', '同名', '项目', '2026-10-01T08:30:00.000Z'),
      option('p-0002', '同名', '项目', '2026-10-02T09:45:00.000Z'),
      option('p-0003', '同名', '项目', '2026-10-02T09:45:00.000Z'),
      option('p-0004', '独特', '项目'),
    ])
    expect(new Set(labels.map((entry) => entry.label)).size).toBe(4)
    expect(labels[0].label).toMatch(/^项目 \/ 同名 · \d{2}\/\d{2}/)
    expect(labels[1].label).toMatch(/· #0002$/)
    expect(labels[2].label).toMatch(/· #0003$/)
    expect(labels[3].label).toBe('项目 / 独特')
    expect(labels.map((entry) => entry.value)).toEqual(['p-0001', 'p-0002', 'p-0003', 'p-0004'])
  })

  it('does not invent a time for an unreadable update stamp', () => {
    expect(formatInheritUpdatedAt('')).toBe('')
    expect(formatInheritUpdatedAt('not a date')).toBe('')
    expect(formatInheritUpdatedAt('2026-10-01T08:30:00.000Z')).not.toBe('')
    const labels = inheritSourceSelectOptions([option('p-0001', '同名', '项目', ''), option('p-0002', '同名', '项目', '')])
    expect(labels.map((entry) => entry.label)).toEqual(['项目 / 同名 · #0001', '项目 / 同名 · #0002'])
  })
})

describe('inheritable materials', () => {
  it('accepts only finished, shared, undeleted rows', () => {
    expect(isInheritableMaterial(material('ok'))).toBe(true)
    expect(isInheritableMaterial(material('processing', { status: 'processing' }))).toBe(false)
    expect(isInheritableMaterial(material('failed', { status: 'failed' }))).toBe(false)
    expect(isInheritableMaterial(material('trashed', { deletedAt: '2026-11-02T00:00:00.000Z' }))).toBe(false)
    expect(isInheritableMaterial(material('personal', { personal: true }))).toBe(false)
    expect(isInheritableMaterial(material('owned', { personalOwnerId: 'user-1' }))).toBe(false)
  })

  it('counts every origin and the total', () => {
    const items = [
      material('g1'),
      material('g2', { source: 'toolbox' }),
      material('u1', { source: 'upload' }),
      material('i1', { metadata: inherited }),
      material('i2', { source: 'upload', metadata: inherited }),
    ]
    expect(countMaterialOrigins(items)).toEqual({ all: 5, generated: 2, uploaded: 1, inherited: 2 })
    expect(countMaterialOrigins([])).toEqual({ all: 0, generated: 0, uploaded: 0, inherited: 0 })
  })

  it('filters by origin and keeps the order', () => {
    const items = [
      material('g1'), material('u1', { source: 'upload' }), material('i1', { metadata: inherited }), material('g2', { source: 'production' }),
    ]
    const ids = (origin: 'all' | 'generated' | 'uploaded' | 'inherited') =>
      filterInheritableMaterials(items, { origin, query: '' }).map((item) => item.id)
    expect(ids('all')).toEqual(['g1', 'u1', 'i1', 'g2'])
    expect(ids('generated')).toEqual(['g1', 'g2'])
    expect(ids('uploaded')).toEqual(['u1'])
    expect(ids('inherited')).toEqual(['i1'])
  })

  it('searches titles fuzzily on top of the origin filter and never mutates the input', () => {
    const items = [
      material('a', { title: '关羽 正面' }),
      material('b', { title: '张飞 侧面', source: 'upload' }),
      material('c', { title: null }),
    ]
    const snapshot = [...items]
    expect(filterInheritableMaterials(items, { origin: 'all', query: '关羽' }).map((item) => item.id)).toEqual(['a'])
    expect(filterInheritableMaterials(items, { origin: 'uploaded', query: '关羽' })).toEqual([])
    expect(filterInheritableMaterials(items, { origin: 'all', query: '   ' }).map((item) => item.id)).toEqual(['a', 'b', 'c'])
    expect(filterInheritableMaterials(items, { origin: 'all', query: '面' }).map((item) => item.id).sort()).toEqual(['a', 'b'])
    expect(items).toEqual(snapshot)
  })
})

describe('inherit selection', () => {
  const many = (count: number) => Array.from({ length: count }, (_, index) => material(`m-${index}`))
  const ids = (count: number) => many(count).map((item) => item.id)

  it('selects every loaded item by default, up to the cap', () => {
    expect(defaultInheritSelection(many(3))).toEqual(['m-0', 'm-1', 'm-2'])
    expect(defaultInheritSelection([])).toEqual([])
    expect(defaultInheritSelection(many(MAX_INHERITED_MATERIALS + 25))).toHaveLength(MAX_INHERITED_MATERIALS)
  })

  it('toggles one id, refusing to grow past the cap', () => {
    expect(toggleInheritSelection(['a'], 'b')).toEqual(['a', 'b'])
    expect(toggleInheritSelection(['a', 'b'], 'a')).toEqual(['b'])
    const full = ids(MAX_INHERITED_MATERIALS)
    expect(toggleInheritSelection(full, 'extra')).toEqual(full)
    expect(toggleInheritSelection(full, 'extra')).not.toBe(full)
    expect(toggleInheritSelection(full, 'm-0')).toHaveLength(MAX_INHERITED_MATERIALS - 1)
  })

  it('select-all adds the visible rows without duplicating or exceeding the cap', () => {
    expect(selectInheritMaterials(['m-1'], many(3))).toEqual(['m-1', 'm-0', 'm-2'])
    expect(selectInheritMaterials([], [])).toEqual([])
    const nearlyFull = ids(MAX_INHERITED_MATERIALS - 1)
    expect(selectInheritMaterials(nearlyFull, [material('x1'), material('x2')])).toEqual([...nearlyFull, 'x1'])
    const full = ids(MAX_INHERITED_MATERIALS)
    expect(selectInheritMaterials(full, [material('x1')])).toEqual(full)
  })

  it('clearing the visible rows keeps selections hidden by the current filter', () => {
    const visible = [material('a'), material('b')]
    expect(clearInheritMaterials(['a', 'b', 'hidden'], visible)).toEqual(['hidden'])
    expect(clearInheritMaterials(['hidden'], visible)).toEqual(['hidden'])
    expect(clearInheritMaterials(['a'], [])).toEqual(['a'])
    expect(clearInheritMaterials([], visible)).toEqual([])
  })
})

describe('submit gate', () => {
  const ready = { mode: 'chosen' as const, sourceProjectId: 'p1', loading: false, error: null, selectedCount: 3 }

  it('lets a creation without inheritance through whatever else is going on', () => {
    expect(inheritSubmitIssue({ mode: 'none', sourceProjectId: '', loading: true, error: '坏了', selectedCount: 0 })).toBeNull()
  })

  it('lets a fully prepared choice through', () => {
    expect(inheritSubmitIssue(ready)).toBeNull()
    expect(inheritSubmitIssue({ ...ready, mode: 'previous' })).toBeNull()
  })

  it('explains what is missing, most fundamental problem first', () => {
    expect(inheritSubmitIssue({ ...ready, sourceProjectId: '' })).toBe('请选择要继承资产的作品。')
    expect(inheritSubmitIssue({ ...ready, mode: 'previous', sourceProjectId: '' })).toBe('当前项目还没有可继承的上一个作品。')
    expect(inheritSubmitIssue({ ...ready, loading: true, error: '坏了', selectedCount: 0 })).toBe('正在读取要继承的资产，请稍候。')
    expect(inheritSubmitIssue({ ...ready, error: '坏了', selectedCount: 0 })).toBe('无法读取要继承的资产，请重试，或选择“不继承”。')
    expect(inheritSubmitIssue({ ...ready, selectedCount: 0 })).toBe('请至少选择一项要继承的资产，或选择“不继承”。')
  })
})

describe('stale inherit error detection', () => {
  const ready = { mode: 'chosen' as const, sourceProjectId: 'p1', loading: false, error: null, selectedCount: 3 }
  const everyIssue = [
    inheritSubmitIssue({ ...ready, sourceProjectId: '' }),
    inheritSubmitIssue({ ...ready, mode: 'previous', sourceProjectId: '' }),
    inheritSubmitIssue({ ...ready, loading: true }),
    inheritSubmitIssue({ ...ready, error: '坏了' }),
    inheritSubmitIssue({ ...ready, selectedCount: 0 }),
  ]

  it('recognises every message the submit gate can produce', () => {
    expect(new Set(everyIssue).size).toBe(5)
    for (const issue of everyIssue) expect(isInheritIssueMessage(issue), String(issue)).toBe(true)
  })

  it('leaves unrelated dialog errors and an empty state alone', () => {
    expect(isInheritIssueMessage(null)).toBe(false)
    expect(isInheritIssueMessage('')).toBe(false)
    expect(isInheritIssueMessage('创建作品失败，请稍后重试。')).toBe(false)
    expect(isInheritIssueMessage('请输入作品名称。')).toBe(false)
  })
})
