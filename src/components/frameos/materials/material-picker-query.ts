import type { FrameosMaterialItem, FrameosMaterialProjectOption, MaterialType } from './contracts'
import {
  frameosAssetCategoryFromMetadata,
  type FrameosAssetCategory,
} from '@/lib/frameos/material-category'

export type MaterialPickerScope = 'all' | 'favorites' | 'project' | 'workflow' | 'toolbox' | 'canvas' | 'upload' | 'trash'
export type MaterialPickerSort = 'newest' | 'oldest'

export function shouldResetMaterialProjectScope(
  scope: MaterialPickerScope,
  selectedProjectId?: string | null,
): boolean {
  return scope === 'project' && !selectedProjectId?.trim()
}

export function normalizeMaterialProjectOptions(
  projects: FrameosMaterialProjectOption[],
  currentProjectId?: string | null,
): FrameosMaterialProjectOption[] {
  const unique = new Map<string, FrameosMaterialProjectOption>()
  for (const project of projects) {
    const id = project.id?.trim()
    const name = project.name?.trim()
    if (!id || !name || unique.has(id)) continue
    unique.set(id, { id, name })
  }
  return [...unique.values()].sort((left, right) => {
    if (left.id === currentProjectId) return -1
    if (right.id === currentProjectId) return 1
    return left.name.localeCompare(right.name, 'zh-CN')
  })
}

const SOURCE_BY_SCOPE: Partial<Record<MaterialPickerScope, FrameosMaterialItem['source']>> = {
  workflow: 'production',
  toolbox: 'toolbox',
  canvas: 'creative',
  upload: 'upload',
}

function dateBoundary(value: string, endOfDay: boolean): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
  if (!match) return ''
  const [, year, month, day] = match
  return new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    endOfDay ? 23 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 999 : 0,
  ).toISOString()
}

export function buildMaterialPickerQuery({
  projectId,
  scope,
  type,
  query,
  creator,
  createdFrom,
  createdTo,
  favoriteOnly = false,
  sync = false,
}: {
  projectId?: string | null
  scope: MaterialPickerScope
  type: MaterialType | 'all'
  query?: string
  creator?: string
  createdFrom?: string
  createdTo?: string
  favoriteOnly?: boolean
  sync?: boolean
}): URLSearchParams {
  const params = new URLSearchParams({
    available: scope === 'project' ? '0' : '1',
    limit: '300',
  })
  if (projectId?.trim()) params.set('projectId', projectId.trim())
  if (scope === 'trash') params.set('state', 'deleted')
  if (type !== 'all') params.set('type', type)
  const source = SOURCE_BY_SCOPE[scope]
  if (source) params.set('source', source)
  if (scope === 'favorites' || favoriteOnly) params.set('favorite', '1')
  if (query?.trim()) params.set('query', query.trim())
  if (creator?.trim()) params.set('creator', creator.trim())
  const from = createdFrom ? dateBoundary(createdFrom, false) : ''
  const to = createdTo ? dateBoundary(createdTo, true) : ''
  if (from) params.set('createdFrom', from)
  if (to) params.set('createdTo', to)
  if (sync) params.set('sync', '1')
  return params
}

export function sortMaterialPickerItems(
  materials: FrameosMaterialItem[],
  sort: MaterialPickerSort,
): FrameosMaterialItem[] {
  const direction = sort === 'oldest' ? 1 : -1
  return [...materials].sort((left, right) => {
    const leftTime = new Date(left.createdAt).getTime()
    const rightTime = new Date(right.createdAt).getTime()
    const safeLeft = Number.isFinite(leftTime) ? leftTime : 0
    const safeRight = Number.isFinite(rightTime) ? rightTime : 0
    return (safeLeft - safeRight) * direction
  })
}

export function filterMaterialPickerItemsByCategory(
  materials: FrameosMaterialItem[],
  assetCategory?: FrameosAssetCategory | null,
): FrameosMaterialItem[] {
  if (!assetCategory) return materials
  return materials.filter((material) => frameosAssetCategoryFromMetadata(material.metadata) === assetCategory)
}
