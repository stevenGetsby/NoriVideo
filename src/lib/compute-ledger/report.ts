/**
 * 日报 / 周 / 三日 报表读取：区间内 facts + 未作废 entries 合并成 LedgerCell，
 * 再投影成三种视图（aggregate.ts 纯函数）。footer 对整个筛选结果求和，不是当前页。
 * getReportFull 返回全量行（供 CSV 导出）；getReport 在其上做 day 视图分页。
 */
import { prisma } from '@/lib/prisma'
import { ApiError } from '@/lib/api-errors'
import { toMoneyNumber } from '@/lib/billing/money'
import {
  type Category,
  type EntryKind,
  actorKey,
  addDaysKey,
  daysBetweenKeys,
  toMicros,
  todayKey,
  weekStartKey,
} from './calc'
import {
  type DayReportRow,
  type ProjectMeta,
  type ReportFooter,
  type TriReportRow,
  type WeekReportRow,
  buildDayReport,
  buildLedgerCells,
  buildTriReport,
  buildWeekReport,
  type LedgerEntryInput,
  type LedgerFactInput,
} from './aggregate'
import { syncPlatformFacts } from './sync'

export type ReportView = 'day' | 'week' | 'tri'

export type ReportQuery = {
  view: ReportView
  from?: string | null
  to?: string | null
  projectId?: string | null
  actorKey?: string | null
  page?: number
  pageSize?: number
}

export type ReportFull = {
  view: ReportView
  range: { from: string; to: string }
  rows: DayReportRow[] | WeekReportRow[] | TriReportRow[]
  footer: ReportFooter
}

export type ReportResponse = ReportFull & {
  totalRows: number
  page: number
  pageSize: number
}

const MAX_DAYS: Record<ReportView, number> = { day: 93, week: 400, tri: 400 }

function defaultRange(view: ReportView, today: string): { from: string; to: string } {
  if (view === 'week') {
    return { from: addDaysKey(weekStartKey(today), -49), to: today }
  }
  return { from: addDaysKey(today, -29), to: today }
}

export async function getReportFull(ownerId: string, query: ReportQuery): Promise<ReportFull> {
  await syncPlatformFacts(ownerId)
  const today = todayKey()
  const defaults = defaultRange(query.view, today)
  const from = query.from ?? defaults.from
  const to = query.to ?? defaults.to
  if (from > to) throw new ApiError('INVALID_PARAMS', { message: 'from 不能晚于 to。' })
  if (daysBetweenKeys(from, to) + 1 > MAX_DAYS[query.view]) {
    throw new ApiError('INVALID_PARAMS', { message: `${query.view} 视图查询区间不能超过 ${MAX_DAYS[query.view]} 天。` })
  }

  const dateKey = { gte: from, lte: to }
  const projectFilter = query.projectId ? { ledgerProjectId: query.projectId } : {}
  const actorUserIdFilter = query.actorKey?.startsWith('u:') ? { actorUserId: query.actorKey.slice(2) } : {}
  const labelActorFilter = query.actorKey?.startsWith('l:')
    ? { actorUserId: null, actorLabel: query.actorKey.slice(2) }
    : {}

  const facts = await prisma.ledgerDailyFact.groupBy({
    by: ['ledgerProjectId', 'dateKey', 'actorUserId'],
    where: { workspaceOwnerId: ownerId, dateKey, ...projectFilter, ...actorUserIdFilter },
    _sum: { costCny: true },
  })
  const entries = await prisma.ledgerEntry.findMany({
    where: { workspaceOwnerId: ownerId, voidedAt: null, dateKey, ...projectFilter, ...labelActorFilter, ...actorUserIdFilter },
    select: {
      ledgerProjectId: true, dateKey: true, actorUserId: true, actorLabel: true,
      kind: true, quantity: true, amountCny: true, remark: true,
    },
  })

  const actorIds = new Set<string>()
  for (const row of facts) actorIds.add(row.actorUserId)
  for (const row of entries) if (row.actorUserId) actorIds.add(row.actorUserId)
  const users = actorIds.size > 0
    ? await prisma.user.findMany({ where: { id: { in: [...actorIds] } }, select: { id: true, name: true } })
    : []
  const userName = new Map(users.map((user) => [user.id, user.name ?? '']))
  const factLabels = await prisma.ledgerDailyFact.findMany({
    where: { workspaceOwnerId: ownerId },
    select: { actorUserId: true, actorLabel: true },
    distinct: ['actorUserId'],
  })
  const factLabel = new Map(factLabels.map((row) => [row.actorUserId, row.actorLabel]))
  const actorName = (id: string | null, label: string): string =>
    (id ? userName.get(id) || factLabel.get(id) : '') || label || '未知账号'

  const factInputs: LedgerFactInput[] = facts.map((row) => ({
    dateKey: row.dateKey,
    projectId: row.ledgerProjectId,
    actorKey: actorKey(row.actorUserId, ''),
    actorName: actorName(row.actorUserId, ''),
    costMicros: toMicros(toMoneyNumber(row._sum.costCny)),
  }))
  const entryInputs: LedgerEntryInput[] = entries.map((row) => ({
    dateKey: row.dateKey,
    projectId: row.ledgerProjectId,
    actorKey: actorKey(row.actorUserId, row.actorLabel),
    actorName: actorName(row.actorUserId, row.actorLabel),
    kind: row.kind as EntryKind,
    quantity: toMoneyNumber(row.quantity),
    amountMicros: toMicros(toMoneyNumber(row.amountCny)),
    remark: row.remark,
  }))

  const cells = buildLedgerCells(factInputs, entryInputs)
  const projectIds = [...new Set(cells.map((cell) => cell.projectId))]
  const projects = projectIds.length > 0
    ? await prisma.ledgerProject.findMany({ where: { workspaceOwnerId: ownerId, id: { in: projectIds } }, select: { id: true, name: true, category: true } })
    : []
  const projectMeta = new Map<string, ProjectMeta>(projects.map((project) => [project.id, { name: project.name, category: (project.category as Category | null) ?? null }]))

  if (query.view === 'day') {
    const { rows, footer } = buildDayReport(cells, projectMeta)
    return { view: 'day', range: { from, to }, rows, footer }
  }
  if (query.view === 'week') {
    const { rows, footer } = buildWeekReport(cells, projectMeta)
    return { view: 'week', range: { from, to }, rows, footer }
  }
  const { rows, footer } = buildTriReport(cells, projectMeta)
  return { view: 'tri', range: { from, to }, rows, footer }
}

export async function getReport(ownerId: string, query: ReportQuery): Promise<ReportResponse> {
  const full = await getReportFull(ownerId, query)
  const page = Math.max(1, query.page ?? 1)
  const pageSize = Math.min(1000, Math.max(1, query.pageSize ?? 200))
  if (full.view === 'day') {
    const rows = full.rows as DayReportRow[]
    return {
      ...full,
      rows: rows.slice((page - 1) * pageSize, page * pageSize),
      totalRows: rows.length,
      page,
      pageSize,
    }
  }
  return { ...full, totalRows: full.rows.length, page: 1, pageSize: full.rows.length }
}
