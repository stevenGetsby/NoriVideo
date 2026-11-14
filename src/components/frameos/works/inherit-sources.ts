import { filterByFuzzyQuery, normalizeSearchText } from '@/lib/frameos/fuzzy-match'
import { materialOrigin, MAX_INHERITED_MATERIALS, type MaterialOrigin } from '@/lib/frameos/material-inherit'
import type { FrameosMaterialItem } from '../materials/contracts'
import type { WorkSummary } from './types'

export type InheritMode = 'none' | 'previous' | 'chosen'
export type InheritOriginFilter = 'all' | MaterialOrigin

export interface InheritSourceOption {
  projectId: string
  projectName: string
  workId: string
  workName: string
  updatedAt: string
}

export function inheritSourceLabel(option: Pick<InheritSourceOption, 'workName' | 'projectName'>): string {
  return `${option.workName} / ${option.projectName}`
}

function timestamp(value: string): number {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export function formatInheritUpdatedAt(value: string): string {
  if (!timestamp(value)) return ''
  return new Date(value).toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  })
}

/** Every readable 作品, the target 项目's own first, then most recently updated. */
export function buildInheritSourceOptions(
  works: readonly WorkSummary[],
  currentWorkId: string,
): InheritSourceOption[] {
  const options = new Map<string, InheritSourceOption>()
  for (const work of works) {
    for (const project of work.projects) {
      if (!project.id || options.has(project.id)) continue
      options.set(project.id, {
        projectId: project.id,
        projectName: project.name,
        workId: work.id,
        workName: work.name,
        updatedAt: project.updatedAt || project.createdAt || '',
      })
    }
  }
  return [...options.values()].sort((left, right) =>
    Number(right.workId === currentWorkId) - Number(left.workId === currentWorkId)
    || timestamp(right.updatedAt) - timestamp(left.updatedAt)
    || left.projectName.localeCompare(right.projectName, 'zh-CN')
    || left.projectId.localeCompare(right.projectId))
}

/** Same-named 作品 would be indistinguishable in the picker, so they get their update time (then an id tail). */
export function inheritSourceSelectOptions(
  options: readonly InheritSourceOption[],
): Array<{ value: string; label: string }> {
  const count = (labels: readonly string[]) => {
    const totals = new Map<string, number>()
    for (const label of labels) totals.set(label, (totals.get(label) ?? 0) + 1)
    return totals
  }
  const base = options.map((option) => inheritSourceLabel(option))
  const baseTotals = count(base)
  const dated = options.map((option, index) => {
    if ((baseTotals.get(base[index]) ?? 0) < 2) return base[index]
    const updated = formatInheritUpdatedAt(option.updatedAt)
    return updated ? `${base[index]} · ${updated}` : base[index]
  })
  const datedTotals = count(dated)
  return options.map((option, index) => ({
    value: option.projectId,
    label: (datedTotals.get(dated[index]) ?? 0) < 2 ? dated[index] : `${dated[index]} · #${option.projectId.slice(-4)}`,
  }))
}

/** The most recently updated 作品 of the 项目 the new one is created in. */
export function previousInheritSource(
  options: readonly InheritSourceOption[],
  currentWorkId: string,
): InheritSourceOption | null {
  return options.find((option) => option.workId === currentWorkId) ?? null
}

/** Only shared, finished rows can be copied; the server re-checks every id. */
export function isInheritableMaterial(item: FrameosMaterialItem): boolean {
  return item.status === 'ready' && !item.deletedAt && !item.personal && !item.personalOwnerId
}

export function countMaterialOrigins(
  items: readonly FrameosMaterialItem[],
): Record<InheritOriginFilter, number> {
  const counts: Record<InheritOriginFilter, number> = { all: items.length, generated: 0, uploaded: 0, inherited: 0 }
  for (const item of items) counts[materialOrigin(item)] += 1
  return counts
}

export function filterInheritableMaterials(
  items: readonly FrameosMaterialItem[],
  { origin, query }: { origin: InheritOriginFilter; query: string },
): FrameosMaterialItem[] {
  const byOrigin = origin === 'all' ? items.slice() : items.filter((item) => materialOrigin(item) === origin)
  if (!normalizeSearchText(query)) return byOrigin
  return filterByFuzzyQuery(byOrigin.map((item) => ({ label: item.title || '', item })), query)
    .map((entry) => entry.item)
}

const ISSUE_CHOOSE_SOURCE = '请选择要继承资产的作品。'
const ISSUE_NO_PREVIOUS = '当前项目还没有可继承的上一个作品。'
const ISSUE_LOADING = '正在读取要继承的资产，请稍候。'
const ISSUE_READ_FAILED = '无法读取要继承的资产，请重试，或选择“不继承”。'
const ISSUE_NOTHING_SELECTED = '请至少选择一项要继承的资产，或选择“不继承”。'
const INHERIT_ISSUES: ReadonlySet<string> = new Set([
  ISSUE_CHOOSE_SOURCE, ISSUE_NO_PREVIOUS, ISSUE_LOADING, ISSUE_READ_FAILED, ISSUE_NOTHING_SELECTED,
])

/** True for a dialog error that only describes the inherit choice, so it can go away once the choice changes. */
export function isInheritIssueMessage(message: string | null): boolean {
  return message !== null && INHERIT_ISSUES.has(message)
}

/** The message that blocks submitting an inherit choice, or null when it is ready to send. */
export function inheritSubmitIssue(state: {
  mode: InheritMode
  sourceProjectId: string
  loading: boolean
  error: string | null
  selectedCount: number
}): string | null {
  if (state.mode === 'none') return null
  if (!state.sourceProjectId) return state.mode === 'chosen' ? ISSUE_CHOOSE_SOURCE : ISSUE_NO_PREVIOUS
  if (state.loading) return ISSUE_LOADING
  if (state.error) return ISSUE_READ_FAILED
  if (state.selectedCount === 0) return ISSUE_NOTHING_SELECTED
  return null
}

export function defaultInheritSelection(items: readonly FrameosMaterialItem[]): string[] {
  return items.slice(0, MAX_INHERITED_MATERIALS).map((item) => item.id)
}

export function toggleInheritSelection(selected: readonly string[], id: string): string[] {
  if (selected.includes(id)) return selected.filter((value) => value !== id)
  return selected.length >= MAX_INHERITED_MATERIALS ? selected.slice() : [...selected, id]
}

export function selectInheritMaterials(selected: readonly string[], visible: readonly FrameosMaterialItem[]): string[] {
  const next = new Set(selected)
  for (const item of visible) {
    if (next.size >= MAX_INHERITED_MATERIALS) break
    next.add(item.id)
  }
  return [...next]
}

export function clearInheritMaterials(selected: readonly string[], visible: readonly FrameosMaterialItem[]): string[] {
  const hidden = new Set(visible.map((item) => item.id))
  return selected.filter((id) => !hidden.has(id))
}
