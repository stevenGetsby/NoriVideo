/**
 * 成员「我的算力」：只返回 actor=我 的日报 cell + 我自己的未作废条目（带 editable）。
 * 不返回预算、项目累计、别人的任何数据（D4）。默认最近 14 天，最多 93 天。
 */
import { prisma } from '@/lib/prisma'
import { ApiError } from '@/lib/api-errors'
import { toMoneyNumber } from '@/lib/billing/money'
import { type Category, type EntryKind, actorKey, addDaysKey, daysBetweenKeys, fromMicros, toMicros, todayKey } from './calc'
import { type DayReportRow, type ProjectMeta, buildDayReport, buildLedgerCells, cellTotalMicros, type LedgerEntryInput, type LedgerFactInput } from './aggregate'
import { type EntryView, listMyEntries } from './entries'
import { syncPlatformFacts } from './sync'
import type { LedgerCtx } from './route-helpers'

export type MeResponse = {
  range: { from: string; to: string }
  summary: { totalCny: number; platformCny: number; externalCny: number }
  rows: DayReportRow[]
  entries: EntryView[]
}

export async function getMe(ctx: LedgerCtx, from: string | null, to: string | null): Promise<MeResponse> {
  await syncPlatformFacts(ctx.ownerId)
  const today = todayKey()
  const resolvedFrom = from ?? addDaysKey(today, -13)
  const resolvedTo = to ?? today
  if (resolvedFrom > resolvedTo) throw new ApiError('INVALID_PARAMS', { message: 'from 不能晚于 to。' })
  if (daysBetweenKeys(resolvedFrom, resolvedTo) + 1 > 93) {
    throw new ApiError('INVALID_PARAMS', { message: '查询区间不能超过 93 天。' })
  }
  const dateKey = { gte: resolvedFrom, lte: resolvedTo }

  const facts = await prisma.ledgerDailyFact.groupBy({
    by: ['ledgerProjectId', 'dateKey'],
    where: { workspaceOwnerId: ctx.ownerId, actorUserId: ctx.actorId, dateKey },
    _sum: { costCny: true },
  })
  const entries = await prisma.ledgerEntry.findMany({
    where: { workspaceOwnerId: ctx.ownerId, actorUserId: ctx.actorId, voidedAt: null, dateKey },
    select: { ledgerProjectId: true, dateKey: true, actorLabel: true, kind: true, quantity: true, amountCny: true, remark: true },
  })
  const self = await prisma.user.findUnique({ where: { id: ctx.actorId }, select: { name: true } })
  const myName = self?.name ?? '我'
  const myKey = actorKey(ctx.actorId, myName)

  const factInputs: LedgerFactInput[] = facts.map((row) => ({
    dateKey: row.dateKey,
    projectId: row.ledgerProjectId,
    actorKey: myKey,
    actorName: myName,
    costMicros: toMicros(toMoneyNumber(row._sum.costCny)),
  }))
  const entryInputs: LedgerEntryInput[] = entries.map((row) => ({
    dateKey: row.dateKey,
    projectId: row.ledgerProjectId,
    actorKey: myKey,
    actorName: myName,
    kind: row.kind as EntryKind,
    quantity: toMoneyNumber(row.quantity),
    amountMicros: toMicros(toMoneyNumber(row.amountCny)),
    remark: row.remark,
  }))

  const cells = buildLedgerCells(factInputs, entryInputs)
  const projectIds = [...new Set(cells.map((cell) => cell.projectId))]
  const projects = projectIds.length > 0
    ? await prisma.ledgerProject.findMany({ where: { workspaceOwnerId: ctx.ownerId, id: { in: projectIds } }, select: { id: true, name: true, category: true } })
    : []
  const projectMeta = new Map<string, ProjectMeta>(projects.map((project) => [project.id, { name: project.name, category: (project.category as Category | null) ?? null }]))
  const { rows } = buildDayReport(cells, projectMeta)

  let totalMicros = 0
  let platformMicros = 0
  for (const cell of cells) {
    totalMicros += cellTotalMicros(cell)
    platformMicros += cell.platformMicros
  }

  return {
    range: { from: resolvedFrom, to: resolvedTo },
    summary: {
      totalCny: fromMicros(totalMicros),
      platformCny: fromMicros(platformMicros),
      externalCny: fromMicros(totalMicros - platformMicros),
    },
    rows,
    entries: await listMyEntries(ctx, resolvedFrom, resolvedTo),
  }
}