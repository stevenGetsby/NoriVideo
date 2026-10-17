import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { MaterialPickerDialog } from '@/components/frameos/materials/MaterialPickerDialog'
import { MaterialUploadDialog } from '@/components/frameos/views/FosMaterialLibrary'
import type { FrameosMaterialItem } from '@/components/frameos/materials/contracts'
import {
  buildMaterialPickerQuery,
  filterMaterialPickerItemsByCategory,
  normalizeMaterialProjectOptions,
  shouldResetMaterialProjectScope,
  sortMaterialPickerItems,
  type MaterialPickerScope,
} from '@/components/frameos/materials/material-picker-query'

vi.mock('next-auth/react', () => ({
  useSession: () => ({
    data: { user: { name: '管理员', role: 'admin', permissions: ['assetWrite'] } },
    status: 'authenticated',
  }),
}))

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode } & Record<string, unknown>) =>
    React.createElement('a', { href, ...props }, children),
}))

beforeAll(() => vi.stubGlobal('React', React))
afterAll(() => vi.unstubAllGlobals())

function material(id: string, createdAt: string, assetCategory?: string): FrameosMaterialItem {
  return {
    id,
    projectId: 'project-1',
    projectName: '短剧作品',
    ownerName: '管理员',
    title: id,
    type: 'image',
    source: 'upload',
    status: 'ready',
    isFavorited: false,
    resultUrl: `materials/${id}.jpg`,
    storageKey: `materials/${id}.jpg`,
    url: `materials/${id}.jpg`,
    metadata: assetCategory ? { assetCategory } : null,
    createdAt,
    updatedAt: createdAt,
  }
}

describe('FrameOS material picker filters', () => {
  it('locks direct asset-library uploads to the active project category and image files', () => {
    const markup = renderToStaticMarkup(React.createElement(MaterialUploadDialog, {
      projects: [{ id: 'project-1', name: '短剧作品' }],
      initialProjectId: 'project-1',
      initialAssetCategory: 'character',
      lockAssetCategory: true,
      imageOnly: true,
      onCreated: vi.fn(),
      onClose: vi.fn(),
    }))

    expect(markup).toContain('当前入口固定归入角色资产，不会混入其他品类。')
    expect(markup).toContain('accept="image/*"')
    expect(markup).toContain('请选择图片文件')
    expect(markup).toContain('disabled=""')
    expect(markup).toContain('<option value="project-1" selected="">短剧作品</option>')
  })

  it('renders the real scope tree, filters, and a capability-gated trash scope', () => {
    const markup = renderToStaticMarkup(React.createElement(MaterialPickerDialog, {
      projectId: 'project-1',
      allowAllTypes: true,
      multiple: true,
      onClose: vi.fn(),
    }))

    for (const label of ['全部素材', '我的收藏', '工作流素材', '工具箱素材', '画布素材', '上传素材']) {
      expect(markup).toContain(label)
    }
    for (const label of ['收藏', '由我创建', '创建时间 ↓', '开始日期', '结束日期']) {
      expect(markup).toContain(label)
    }
    expect(markup).toContain('已删除')
    expect(markup).toContain('正在确认回收站能力')
    expect(markup).toContain('data-testid="material-trash-scope"')
    expect(markup).toContain('material-picker-overlay fos-viewport-theme')
    expect(markup).toContain('disabled=""')
  })

  it('deduplicates readable projects, keeps the current project first, and never invents a project', () => {
    expect(normalizeMaterialProjectOptions([
      { id: 'project-b', name: '乙作品' },
      { id: ' project-a ', name: ' 甲作品 ' },
      { id: 'project-b', name: '重复作品' },
      { id: '', name: '无效作品' },
    ], 'project-b')).toEqual([
      { id: 'project-b', name: '乙作品' },
      { id: 'project-a', name: '甲作品' },
    ])
  })

  it('keeps a selected API project active even when the dialog has no initial project prop', () => {
    expect(shouldResetMaterialProjectScope('project', 'project-from-api')).toBe(false)
    expect(shouldResetMaterialProjectScope('project', '')).toBe(true)
    expect(shouldResetMaterialProjectScope('all', '')).toBe(false)
  })

  it('passes every supported server filter with normalized date boundaries', () => {
    const params = buildMaterialPickerQuery({
      projectId: ' project-1 ',
      scope: 'favorites',
      type: 'video',
      query: ' 雨夜 ',
      creator: ' 管理员 ',
      createdFrom: '2026-07-01',
      createdTo: '2026-07-18',
      sync: true,
    })

    expect(params.get('projectId')).toBe('project-1')
    expect(params.get('available')).toBe('1')
    expect(params.get('type')).toBe('video')
    expect(params.get('favorite')).toBe('1')
    expect(params.get('query')).toBe('雨夜')
    expect(params.get('creator')).toBe('管理员')
    expect(params.get('createdFrom')).toBe(new Date(2026, 6, 1, 0, 0, 0, 0).toISOString())
    expect(params.get('createdTo')).toBe(new Date(2026, 6, 18, 23, 59, 59, 999).toISOString())
    expect(params.get('sync')).toBe('1')

    const combined = buildMaterialPickerQuery({
      scope: 'canvas',
      type: 'image',
      favoriteOnly: true,
    })
    expect(combined.get('source')).toBe('creative')
    expect(combined.get('favorite')).toBe('1')
  })

  it('maps visible source scopes to persisted source fields and isolates project scope', () => {
    const persistedSources: Array<[MaterialPickerScope, string]> = [
      ['workflow', 'production'],
      ['toolbox', 'toolbox'],
      ['canvas', 'creative'],
      ['upload', 'upload'],
    ]
    for (const [scope, source] of persistedSources) {
      expect(buildMaterialPickerQuery({ scope, type: 'all' }).get('source')).toBe(source)
    }

    const project = buildMaterialPickerQuery({ projectId: 'project-1', scope: 'project', type: 'all' })
    expect(project.get('available')).toBe('0')
    expect(project.has('source')).toBe(false)

    const trash = buildMaterialPickerQuery({ scope: 'trash', type: 'all' })
    expect(trash.get('state')).toBe('deleted')
    expect(trash.get('available')).toBe('1')
  })

  it('keeps favorites, sources, and trash inside the project until the user explicitly browses all projects', () => {
    for (const scope of ['favorites', 'toolbox', 'canvas', 'upload', 'trash'] as MaterialPickerScope[]) {
      const params = buildMaterialPickerQuery({ projectId: 'project-1', scope, type: 'image', projectOnly: true })
      expect(params.get('projectId')).toBe('project-1')
      expect(params.get('available')).toBe('0')
    }
    const all = buildMaterialPickerQuery({ scope: 'all', type: 'image' })
    expect(all.get('available')).toBe('1')
    expect(all.has('projectId')).toBe(false)
    expect(buildMaterialPickerQuery({ scope: 'all', type: 'image', creator: '张', creatorExact: true }).get('creatorExact')).toBe('1')
  })

  it('sorts creation time locally in either direction without mutating API results', () => {
    const original = [
      material('older', '2026-07-01T00:00:00.000Z'),
      material('newer', '2026-07-18T00:00:00.000Z'),
    ]

    expect(sortMaterialPickerItems(original, 'newest').map((item) => item.id)).toEqual(['newer', 'older'])
    expect(sortMaterialPickerItems(original, 'oldest').map((item) => item.id)).toEqual(['older', 'newer'])
    expect(original.map((item) => item.id)).toEqual(['older', 'newer'])
  })

  it('keeps role, location, and prop pickers inside their own asset category', () => {
    const materials = [
      material('character', '2026-07-18T00:00:00.000Z', 'character'),
      material('location', '2026-07-18T00:00:00.000Z', 'location'),
      material('prop', '2026-07-18T00:00:00.000Z', 'prop'),
      material('unclassified', '2026-07-18T00:00:00.000Z'),
    ]

    expect(filterMaterialPickerItemsByCategory(materials, 'character').map((item) => item.id)).toEqual(['character'])
    expect(filterMaterialPickerItemsByCategory(materials, 'location').map((item) => item.id)).toEqual(['location'])
    expect(filterMaterialPickerItemsByCategory(materials, 'prop').map((item) => item.id)).toEqual(['prop'])
    expect(filterMaterialPickerItemsByCategory(materials).map((item) => item.id)).toEqual(materials.map((item) => item.id))
  })
})
