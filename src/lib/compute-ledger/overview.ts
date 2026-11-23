/**
 * 管理员算力表（项目 × 人 + 预算）的读取与合并。
 * 全部用 groupBy，不拉全表；金额在整数微元上累加，返回前一次性 fromMicros。
 * 归档项目的数字照常计入 totals，只是默认不出现在 rows 里。
 */
import { prisma } from '@/lib/prisma'
import { getBillingMode } from '@/lib/billing/mode'
import { toMoneyNumber } from '@/lib/billing/money'
import {
  type BudgetLevel,
  type Category,
  type ProjectStatus,
  actorKey,
  budgetState,
  completionRatio,
  costPerMinute,
  elapsedDays,
  fromMicros,
  toMicros,
  todayKey,
} from './calc'
import { getOrCreateSetting, syncPlatformFacts } from './sync'

export type OverviewByActor = { actorKey: string; name: string; totalCny: number; periodCny: number }

export type OverviewRow = {
  projectId: string
  name: string
  workId: string | null
  workState: 'active' | 'recycled' | 'purged' | 'external'
  duplicateName: boolean
  category: Category | null
  status: ProjectStatus
  startDate: string | null
  completedDate: string | null
  targetDeliveryDate: string | null
  elapsedDays: number | null
  durationMinutes: number | null
  costPerMinute: number | null
  totalEpisodes: number | null
  doneEpisodes: number | null
  completionRatio: number | null
  budgetCny: number | null
  remainingCny: number | null
  usageRatio: number | null
  level: BudgetLevel
  totalCny: number
  periodCny: number
  platformCny: number
  externalCny: number
  byActor: OverviewByActor[]
  archived: boolean
  note: string | null
}

export type OverviewResponse = {
  currency: 'CNY'
  asOf: string
  range: { from: string | null; to: string | null }
  sync: { complete: boolean; syncedThroughDate: string | null; billingMode: 'OFF' | 'SHADOW' | 'ENFORCE' }
  rates: { tokenRateCnyPerMillion: number; jimengCnyPerPoint: number }
  totals: {
    totalCny: number
    periodCny: number
    platformCny: number
    externalCny: number
    budgetCny: number
    overCount: number
    warnCount: number
  }
  rows: OverviewRow[]
}

export type OverviewQuery = {
  from?: string | null
  to?: string | null
  category?: Category | null
  status?: ProjectStatus | null
  includeArchived?: boolean
  refresh?: boolean
}

type ActorAgg = { name: string; totalMicros: number; periodMicros: number }

export async function getOverview(ownerId: string, query: OverviewQuery): Promise<OverviewResponse> {
  const sync = await syncPlatformFacts(ownerId, { refresh: query.refresh })
  const setting = await getOrCreateSetting(ownerId)
  const billingMode = await getBillingMode()
  const today = todayKey()
  const from = query.from ?? null
  const to = query.to ?? null
  const dateFilter = from || to ? { dateKey: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}

  const projects = await prisma.ledgerProject.findMany({ where: { workspaceOwnerId: ownerId } })

  const factsAll = await prisma.ledgerDailyFact.groupBy({
    by: ['ledgerProjectId', 'actorUserId'],
    where: { workspaceOwnerId: ownerId },
    _sum: { costCny: true },
  })
  const factsPeriod = await prisma.ledgerDailyFact.groupBy({
    by: ['ledgerProjectId', 'actorUserId'],
    where: { workspaceOwnerId: ownerId, ...dateFilter },
    _sum: { costCny: true },
  })
  const entriesAll = await prisma.ledgerEntry.groupBy({
    by: ['ledgerProjectId', 'actorUserId', 'actorLabel'],
    where: { workspaceOwnerId: ownerId, voidedAt: null },
    _sum: { amountCny: true },
  })
  const entriesPeriod = await prisma.ledgerEntry.groupBy({
    by: ['ledgerProjectId', 'actorUserId', 'actorLabel'],
    where: { workspaceOwnerId: ownerId, voidedAt: null, ...dateFilter },
    _sum: { amountCny: true },
  })

  const actorIds = new Set<string>()
  for (const row of factsAll) actorIds.add(row.actorUserId)
  for (const row of entriesAll) if (row.actorUserId) actorIds.add(row.actorUserId)
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

  const workIds = projects.map((project) => project.workId).filter((id): id is string => !!id)
  const works = workIds.length > 0
    ? await prisma.work.findMany({ where: { id: { in: workIds } }, select: { id: true, deletedAt: true } })
    : []
  const workState = new Map<string, 'active' | 'recycled'>(works.map((work) => [work.id, work.deletedAt ? 'recycled' : 'active']))

  const nameCounts = new Map<string, number>()
  for (const project of projects) {
    nameCounts.set(project.nameKey, (nameCounts.get(project.nameKey) ?? 0) + 1)
  }

  const platformAll = new Map<string, number>()
  const platformPeriod = new Map<string, number>()
  const externalAll = new Map<string, number>()
  const externalPeriod = new Map<string, number>()
  const actorsAll = new Map<string, Map<string, ActorAgg>>()
  const actorsPeriod = new Map<string, Map<string, ActorAgg>>()

  const addTo = (map: Map<string, number>, projectId: string, micros: number) => {
    map.set(projectId, (map.get(projectId) ?? 0) + micros)
  }
  const addActor = (
    map: Map<string, Map<string, ActorAgg>>,
    projectId: string,
    key: string,
    name: string,
    micros: number,
  ) => {
    let perProject = map.get(projectId)
    if (!perProject) {
      perProject = new Map()
      map.set(projectId, perProject)
    }
    const agg = perProject.get(key) ?? { name, totalMicros: 0, periodMicros: 0 }
    agg.totalMicros += micros
    perProject.set(key, agg)
  }

  for (const row of factsAll) {
    const micros = toMicros(toMoneyNumber(row._sum.costCny))
    addTo(platformAll, row.ledgerProjectId, micros)
    addActor(actorsAll, row.ledgerProjectId, actorKey(row.actorUserId, ''), actorName(row.actorUserId, ''), micros)
  }
  for (const row of factsPeriod) {
    const micros = toMicros(toMoneyNumber(row._sum.costCny))
    addTo(platformPeriod, row.ledgerProjectId, micros)
    const perProject = actorsAll.get(row.ledgerProjectId)
    const agg = perProject?.get(actorKey(row.actorUserId, ''))
    if (agg) agg.periodMicros += micros
  }
  for (const row of entriesAll) {
    const micros = toMicros(toMoneyNumber(row._sum.amountCny))
    addTo(externalAll, row.ledgerProjectId, micros)
    addActor(actorsAll, row.ledgerProjectId, actorKey(row.actorUserId, row.actorLabel), actorName(row.actorUserId, row.actorLabel), micros)
  }
  for (const row of entriesPeriod) {
    const micros = toMicros(toMoneyNumber(row._sum.amountCny))
    addTo(externalPeriod, row.ledgerProjectId, micros)
    const perProject = actorsAll.get(row.ledgerProjectId)
    const agg = perProject?.get(actorKey(row.actorUserId, row.actorLabel))
    if (agg) agg.periodMicros += micros
  }

  let totalMicros = 0
  let periodMicros = 0
  let platformMicros = 0
  let externalMicros = 0
  let budgetMicros = 0
  let overCount = 0
  let warnCount = 0

  const rows: OverviewRow[] = []
  for (const project of projects) {
    const pAll = platformAll.get(project.id) ?? 0
    const eAll = externalAll.get(project.id) ?? 0
    const pPeriod = platformPeriod.get(project.id) ?? 0
    const ePeriod = externalPeriod.get(project.id) ?? 0
    const projectTotal = pAll + eAll
    const projectPeriod = from || to ? pPeriod + ePeriod : projectTotal
    const budgetCny = project.budgetCny == null ? null : toMoneyNumber(project.budgetCny)
    const budget = budgetState(budgetCny, projectTotal)
    const durationMinutes = project.durationMinutes == null ? null : toMoneyNumber(project.durationMinutes)
    const status = project.status as ProjectStatus
    const archived = project.archivedAt != null

    totalMicros += projectTotal
    periodMicros += projectPeriod
    platformMicros += pAll
    externalMicros += eAll
    if (budgetCny != null && budgetCny > 0) budgetMicros += toMicros(budgetCny)
    if (budget.level === 'over') overCount += 1
    if (budget.level === 'warn') warnCount += 1

    const byActor: OverviewByActor[] = [...(actorsAll.get(project.id)?.entries() ?? [])]
      .map(([key, agg]) => ({
        actorKey: key,
        name: agg.name,
        totalCny: fromMicros(agg.totalMicros),
        periodCny: fromMicros(agg.periodMicros),
      }))
      .sort((a, b) => b.totalCny - a.totalCny || a.name.localeCompare(b.name, 'zh-Hans-CN'))

    const workStateValue: OverviewRow['workState'] = project.workId == null
      ? 'external'
      : (workState.get(project.workId) ?? 'purged')

    rows.push({
      projectId: project.id,
      name: project.name,
      workId: project.workId,
      workState: workStateValue,
      duplicateName: (nameCounts.get(project.nameKey) ?? 0) > 1,
      category: (project.category as Category | null) ?? null,
      status,
      startDate: project.startDate,
      completedDate: project.completedDate,
      targetDeliveryDate: project.targetDeliveryDate,
      elapsedDays: elapsedDays(project.startDate, status, project.completedDate, today),
      durationMinutes,
      costPerMinute: costPerMinute(projectTotal, durationMinutes),
      totalEpisodes: project.totalEpisodes,
      doneEpisodes: project.doneEpisodes,
      completionRatio: completionRatio(project.totalEpisodes, project.doneEpisodes),
      budgetCny,
      remainingCny: budget.remainingCny,
      usageRatio: budget.ratio,
      level: budget.level,
      totalCny: fromMicros(projectTotal),
      periodCny: fromMicros(projectPeriod),
      platformCny: fromMicros(pAll),
      externalCny: fromMicros(eAll),
      byActor,
      archived,
      note: project.note ?? null,
    })
  }

  const filtered = rows.filter((row) => {
    if (!query.includeArchived && row.archived) return false
    if (query.category && row.category !== query.category) return false
    if (query.status && row.status !== query.status) return false
    return true
  })
  filtered.sort((a, b) => b.totalCny - a.totalCny || a.name.localeCompare(b.name, 'zh-Hans-CN'))

  return {
    currency: 'CNY',
    asOf: today,
    range: { from, to },
    sync: { complete: sync.complete, syncedThroughDate: sync.syncedThroughDate, billingMode },
    rates: {
      tokenRateCnyPerMillion: toMoneyNumber(setting.tokenRateCnyPerMillion),
      jimengCnyPerPoint: toMoneyNumber(setting.jimengCnyPerPoint),
    },
    totals: {
      totalCny: fromMicros(totalMicros),
      periodCny: fromMicros(periodMicros),
      platformCny: fromMicros(platformMicros),
      externalCny: fromMicros(externalMicros),
      budgetCny: fromMicros(budgetMicros),
      overCount,
      warnCount,
    },
    rows: filtered,
  }
}