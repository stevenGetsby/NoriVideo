/**
 * 账本读取侧的纯聚合：把平台事实与手填条目合并成 LedgerCell，再投影成
 * 日报 / 周 / 三日三种视图。所有金额先在整数微元上累加，最后一次性 fromMicros，
 * 保证「行求和 = 合计」。不依赖 prisma，可脱离数据库单测。
 */
import {
  type Category,
  type EntryKind,
  fromMicros,
  triBucket,
  weekLabel,
  weekStartKey,
} from './calc'

export type LedgerCell = {
  dateKey: string
  projectId: string
  actorKey: string
  actorName: string
  platformMicros: number
  tokenQty: number
  tokenMicros: number
  jimengQty: number
  jimengMicros: number
  otherMicros: number
  remarks: string[]
}

export type LedgerFactInput = {
  dateKey: string
  projectId: string
  actorKey: string
  actorName: string
  costMicros: number
}

export type LedgerEntryInput = {
  dateKey: string
  projectId: string
  actorKey: string
  actorName: string
  kind: EntryKind
  quantity: number
  amountMicros: number
  remark?: string | null
}

export type ProjectMeta = { name: string; category: Category | null }

export function cellTotalMicros(cell: LedgerCell): number {
  return cell.platformMicros + cell.tokenMicros + cell.jimengMicros + cell.otherMicros
}

function cellKey(dateKey: string, projectId: string, actorKey: string): string {
  return `${dateKey}|${projectId}|${actorKey}`
}

/** 合并事实与条目；同键累加，备注去重保序。总额为 0 的 cell 不产出（无数据的日子不出行）。 */
export function buildLedgerCells(
  facts: readonly LedgerFactInput[],
  entries: readonly LedgerEntryInput[],
): LedgerCell[] {
  const map = new Map<string, LedgerCell>()
  const ensure = (dateKey: string, projectId: string, actorKey: string, actorName: string): LedgerCell => {
    const key = cellKey(dateKey, projectId, actorKey)
    let cell = map.get(key)
    if (!cell) {
      cell = {
        dateKey, projectId, actorKey, actorName,
        platformMicros: 0, tokenQty: 0, tokenMicros: 0,
        jimengQty: 0, jimengMicros: 0, otherMicros: 0, remarks: [],
      }
      map.set(key, cell)
    }
    return cell
  }
  for (const fact of facts) {
    const cell = ensure(fact.dateKey, fact.projectId, fact.actorKey, fact.actorName)
    cell.platformMicros += fact.costMicros
  }
  for (const entry of entries) {
    const cell = ensure(entry.dateKey, entry.projectId, entry.actorKey, entry.actorName)
    if (entry.kind === 'api_token') {
      cell.tokenQty += entry.quantity
      cell.tokenMicros += entry.amountMicros
    } else if (entry.kind === 'jimeng_points') {
      cell.jimengQty += entry.quantity
      cell.jimengMicros += entry.amountMicros
    } else {
      cell.otherMicros += entry.amountMicros
    }
    const remark = entry.remark?.trim()
    if (remark && !cell.remarks.includes(remark)) cell.remarks.push(remark)
  }
  return [...map.values()].filter((cell) => cellTotalMicros(cell) !== 0)
}

function projectName(projects: Map<string, ProjectMeta>, projectId: string): string {
  return projects.get(projectId)?.name ?? '未知项目'
}

function projectCategory(projects: Map<string, ProjectMeta>, projectId: string): Category | null {
  return projects.get(projectId)?.category ?? null
}

function byName(a: string, b: string): number {
  return a.localeCompare(b, 'zh-Hans-CN')
}

export type DayReportRow = {
  dateKey: string
  weekLabel: string
  projectId: string
  projectName: string
  category: Category | null
  actorKey: string
  actorName: string
  platformCny: number
  apiTokens: number
  apiTokenCny: number
  jimengPoints: number
  jimengCny: number
  otherCny: number
  totalCny: number
  remark: string
}

export type ReportFooter = { totalCny: number }

export function buildDayReport(
  cells: readonly LedgerCell[],
  projects: Map<string, ProjectMeta>,
): { rows: DayReportRow[]; footer: ReportFooter } {
  let totalMicros = 0
  const rows = cells.map((cell) => {
    const total = cellTotalMicros(cell)
    totalMicros += total
    return {
      dateKey: cell.dateKey,
      weekLabel: weekLabel(weekStartKey(cell.dateKey)),
      projectId: cell.projectId,
      projectName: projectName(projects, cell.projectId),
      category: projectCategory(projects, cell.projectId),
      actorKey: cell.actorKey,
      actorName: cell.actorName,
      platformCny: fromMicros(cell.platformMicros),
      apiTokens: cell.tokenQty,
      apiTokenCny: fromMicros(cell.tokenMicros),
      jimengPoints: cell.jimengQty,
      jimengCny: fromMicros(cell.jimengMicros),
      otherCny: fromMicros(cell.otherMicros),
      totalCny: fromMicros(total),
      remark: cell.remarks.join('；'),
    }
  })
  rows.sort((a, b) =>
    b.dateKey.localeCompare(a.dateKey)
    || byName(a.projectName, b.projectName)
    || byName(a.actorName, b.actorName))
  return { rows, footer: { totalCny: fromMicros(totalMicros) } }
}

export type WeekReportPerson = { actorKey: string; actorName: string; totalCny: number }

export type WeekReportRow = {
  weekStart: string
  weekLabel: string
  projectId: string
  projectName: string
  category: Category | null
  totalCny: number
  people: WeekReportPerson[]
}

export function buildWeekReport(
  cells: readonly LedgerCell[],
  projects: Map<string, ProjectMeta>,
): { rows: WeekReportRow[]; footer: ReportFooter } {
  type Group = { weekStart: string; projectId: string; totalMicros: number; people: Map<string, { actorName: string; micros: number }> }
  const groups = new Map<string, Group>()
  let totalMicros = 0
  for (const cell of cells) {
    const weekStart = weekStartKey(cell.dateKey)
    const key = `${weekStart}|${cell.projectId}`
    let group = groups.get(key)
    if (!group) {
      group = { weekStart, projectId: cell.projectId, totalMicros: 0, people: new Map() }
      groups.set(key, group)
    }
    const micros = cellTotalMicros(cell)
    group.totalMicros += micros
    totalMicros += micros
    const person = group.people.get(cell.actorKey) ?? { actorName: cell.actorName, micros: 0 }
    person.micros += micros
    group.people.set(cell.actorKey, person)
  }
  const rows: WeekReportRow[] = [...groups.values()].map((group) => ({
    weekStart: group.weekStart,
    weekLabel: weekLabel(group.weekStart),
    projectId: group.projectId,
    projectName: projectName(projects, group.projectId),
    category: projectCategory(projects, group.projectId),
    totalCny: fromMicros(group.totalMicros),
    people: [...group.people.entries()]
      .map(([actorKey, person]) => ({ actorKey, actorName: person.actorName, totalCny: fromMicros(person.micros) }))
      .sort((a, b) => b.totalCny - a.totalCny || byName(a.actorName, b.actorName)),
  }))
  rows.sort((a, b) => b.weekStart.localeCompare(a.weekStart) || b.totalCny - a.totalCny || byName(a.projectName, b.projectName))
  return { rows, footer: { totalCny: fromMicros(totalMicros) } }
}

export type TriReportRow = {
  bucketStart: string
  bucketEnd: string
  label: string
  projectId: string
  projectName: string
  category: Category | null
  totalCny: number
}

export function buildTriReport(
  cells: readonly LedgerCell[],
  projects: Map<string, ProjectMeta>,
): { rows: TriReportRow[]; footer: ReportFooter } {
  const groups = new Map<string, { bucketStart: string; bucketEnd: string; label: string; projectId: string; totalMicros: number }>()
  let totalMicros = 0
  for (const cell of cells) {
    const bucket = triBucket(cell.dateKey)
    const key = `${bucket.start}|${cell.projectId}`
    let group = groups.get(key)
    if (!group) {
      group = { bucketStart: bucket.start, bucketEnd: bucket.end, label: bucket.label, projectId: cell.projectId, totalMicros: 0 }
      groups.set(key, group)
    }
    const micros = cellTotalMicros(cell)
    group.totalMicros += micros
    totalMicros += micros
  }
  const rows: TriReportRow[] = [...groups.values()].map((group) => ({
    bucketStart: group.bucketStart,
    bucketEnd: group.bucketEnd,
    label: group.label,
    projectId: group.projectId,
    projectName: projectName(projects, group.projectId),
    category: projectCategory(projects, group.projectId),
    totalCny: fromMicros(group.totalMicros),
  }))
  rows.sort((a, b) => b.bucketStart.localeCompare(a.bucketStart) || byName(a.projectName, b.projectName))
  return { rows, footer: { totalCny: fromMicros(totalMicros) } }
}