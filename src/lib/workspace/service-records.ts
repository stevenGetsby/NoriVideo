import { prisma } from '@/lib/prisma'
import { getBalance } from '@/lib/billing'
import { getVisibleUserTotalSpent } from '@/lib/billing/reporting'
import { BILLING_CURRENCY } from '@/lib/billing/currency'
import { toMoneyNumber } from '@/lib/billing/money'
import { normalizeTaskError } from '@/lib/errors/normalize'
import { listBuiltinPricingCatalog, type PricingApiType } from '@/lib/model-pricing/catalog'
import { BUILTIN_PRICING_VERSION } from '@/lib/model-pricing/version'
import {
  containsInternalRecordMarker,
  isInternalBalanceTransactionRecord,
  isInternalUsageCostRecord,
  parseJsonRecord,
} from './internal-record-visibility'

const API_TYPES: PricingApiType[] = ['text', 'image', 'video', 'voice', 'voice-design', 'lip-sync']

const BILLABLE_TASK_HINTS = [
  'video',
  'image',
  'storyboard',
  'character',
  'location',
  'voice',
  'tts',
  'asset',
  'seedance',
]

const SERVICE_CONFIGS = [
  { id: 'video', apiType: 'video', matcher: /video|seedance/i, unitCost: 6 },
  { id: 'image', apiType: 'image', matcher: /image|storyboard|character|location/i, unitCost: 1 },
  { id: 'voice', apiType: 'voice', matcher: /voice|tts|audio/i, unitCost: 2 },
  { id: 'text', apiType: 'text', matcher: /script|clip|analysis|llm|text/i, unitCost: 1 },
] as const

const ACTION_KEY_PATTERN = /^[a-z][a-z0-9_]*$/

type ServiceTask = Awaited<ReturnType<typeof readTaskRows>>[number]
type UsageCostRow = Awaited<ReturnType<typeof readUsageCosts>>[number]
export interface BuildServiceRecordsOverviewOptions {
  limit?: number
}

function extractActionFromDescription(description: string | null): string | null {
  if (!description) return null
  const cleaned = description.replace(/^\[SHADOW\]\s*/i, '').trim()
  const firstPart = cleaned.split(' - ')[0].trim()
  if (ACTION_KEY_PATTERN.test(firstPart)) return firstPart
  return null
}

function taskErrorMessage(task: { error?: { message?: string | null } | null; errorMessage?: string | null }) {
  return task.error?.message || task.errorMessage || ''
}

function isInternalTask(task: { type: string; targetType: string; error?: { message?: string | null } | null; errorMessage?: string | null }) {
  return containsInternalRecordMarker(task.type, task.targetType, taskErrorMessage(task))
}

function isInternalUsageCost(row: UsageCostRow) {
  return isInternalUsageCostRecord(row)
}

function isInternalTransaction(row: {
  taskType?: string | null
  description?: string | null
  billingMeta?: string | null
}) {
  return isInternalBalanceTransactionRecord(row)
}

function taskTimestamp(task: {
  finishedAt?: string | null
  updatedAt: string
  startedAt?: string | null
  queuedAt?: string | null
  createdAt: string
}) {
  return task.finishedAt || task.updatedAt || task.startedAt || task.queuedAt || task.createdAt
}

function taskDay(task: ServiceTask) {
  const date = new Date(taskTimestamp(task))
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleDateString()
}

function usageCostDay(row: UsageCostRow) {
  return row.createdAt.toLocaleDateString()
}

function isBillableTask(task: ServiceTask) {
  const text = `${task.type} ${task.targetType}`.toLowerCase()
  return task.status === 'completed' && BILLABLE_TASK_HINTS.some((hint) => text.includes(hint))
}

function estimateUnits(task: ServiceTask) {
  if (!isBillableTask(task)) return 0
  const text = `${task.type} ${task.targetType}`.toLowerCase()
  if (text.includes('video') || text.includes('seedance')) return 6
  if (text.includes('voice') || text.includes('tts')) return 2
  if (text.includes('image') || text.includes('storyboard') || text.includes('character') || text.includes('location')) return 1
  return 1
}

function pricingAmounts(entry: ReturnType<typeof listBuiltinPricingCatalog>[number]) {
  if (entry.pricing.mode === 'flat') return [entry.pricing.flatAmount ?? 0]
  return (entry.pricing.tiers || []).map((tier) => tier.amount)
}

function normalizeTaskLimit(value: number | undefined) {
  if (!Number.isFinite(value)) return 80
  return Math.min(Math.max(Math.floor(value ?? 80), 1), 200)
}

function resolveTaskReadLimit(visibleLimit: number) {
  return Math.min(Math.max(visibleLimit * 5, visibleLimit), 500)
}

async function readTaskRows(userId: string, take = 80) {
  const tasks = await prisma.task.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take,
  })

  return tasks.map((task) => ({
    ...task,
    queuedAt: task.queuedAt?.toISOString() ?? null,
    startedAt: task.startedAt?.toISOString() ?? null,
    finishedAt: task.finishedAt?.toISOString() ?? null,
    heartbeatAt: task.heartbeatAt?.toISOString() ?? null,
    enqueuedAt: task.enqueuedAt?.toISOString() ?? null,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
    error: normalizeTaskError(task.errorCode, task.errorMessage),
  }))
}

async function readUsageCosts(userId: string) {
  return await prisma.usageCost.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 200,
  })
}

function buildStats(tasks: ServiceTask[]) {
  const totals = {
    all: tasks.length,
    processing: 0,
    completed: 0,
    failed: 0,
  }
  for (const task of tasks) {
    if (task.status === 'queued' || task.status === 'processing') totals.processing += 1
    if (task.status === 'completed') totals.completed += 1
    if (task.status === 'failed') totals.failed += 1
  }
  return totals
}

function buildUsageRows(tasks: ServiceTask[], usageCosts: UsageCostRow[]) {
  if (usageCosts.length > 0) {
    const rows = new Map<string, { key: string; total: number; completed: number; failed: number; units: number }>()
    for (const row of usageCosts) {
      const key = row.action || row.apiType || 'unknown'
      const current = rows.get(key) || { key, total: 0, completed: 0, failed: 0, units: 0 }
      current.total += 1
      current.completed += 1
      current.units += row.quantity || 0
      rows.set(key, current)
    }
    return Array.from(rows.values())
      .sort((a, b) => b.units - a.units || b.total - a.total)
      .slice(0, 6)
  }

  const rows = new Map<string, { key: string; total: number; completed: number; failed: number; units: number }>()
  for (const task of tasks) {
    const key = task.type || task.targetType || 'unknown'
    const current = rows.get(key) || { key, total: 0, completed: 0, failed: 0, units: 0 }
    current.total += 1
    if (task.status === 'completed') current.completed += 1
    if (task.status === 'failed') current.failed += 1
    current.units += estimateUnits(task)
    rows.set(key, current)
  }
  return Array.from(rows.values())
    .sort((a, b) => b.units - a.units || b.total - a.total)
    .slice(0, 6)
}

function buildDailyUsage(tasks: ServiceTask[], usageCosts: UsageCostRow[]) {
  const rows = new Map<string, { day: string; total: number; units: number }>()
  if (usageCosts.length > 0) {
    for (const row of usageCosts) {
      const day = usageCostDay(row)
      const current = rows.get(day) || { day, total: 0, units: 0 }
      current.total += 1
      current.units += row.quantity || 0
      rows.set(day, current)
    }
    return Array.from(rows.values()).slice(0, 7)
  }

  for (const task of tasks) {
    const day = taskDay(task)
    const current = rows.get(day) || { day, total: 0, units: 0 }
    current.total += 1
    current.units += estimateUnits(task)
    rows.set(day, current)
  }
  return Array.from(rows.values()).slice(0, 7)
}

function buildUsageSummary(tasks: ServiceTask[], usageCosts: UsageCostRow[], usageRows: Array<{ key: string }>) {
  if (usageCosts.length > 0) {
    return {
      billableTasks: usageCosts.length,
      estimatedUnits: usageCosts.reduce((sum, row) => sum + (row.quantity || 0), 0),
      serviceTypes: usageRows.length,
    }
  }

  const billableTasks = tasks.filter(isBillableTask)
  return {
    billableTasks: billableTasks.length,
    estimatedUnits: billableTasks.reduce((sum, task) => sum + estimateUnits(task), 0),
    serviceTypes: usageRows.length,
  }
}

function buildServiceConfigRows(tasks: ServiceTask[]) {
  return SERVICE_CONFIGS.map((config) => {
    const matchedTasks = tasks.filter((task) => config.matcher.test(`${task.type} ${task.targetType}`))
    const completed = matchedTasks.filter((task) => task.status === 'completed').length
    const failed = matchedTasks.filter((task) => task.status === 'failed').length
    const successRate = matchedTasks.length ? Math.round((completed / matchedTasks.length) * 100) : 0
    return {
      id: config.id,
      apiType: config.apiType,
      unitCost: config.unitCost,
      total: matchedTasks.length,
      completed,
      failed,
      successRate,
      enabled: matchedTasks.length > 0,
    }
  })
}

async function buildCostSummary(userId: string, usageCosts: UsageCostRow[]) {
  const projectIds = [...new Set(usageCosts.map((row) => row.projectId))]
  const projects = projectIds.length > 0
    ? await prisma.project.findMany({
      where: {
        id: { in: projectIds },
        userId,
      },
      select: { id: true, name: true },
    })
    : []
  const projectMap = new Map(projects.map((project) => [project.id, project.name]))
  const byProjectMap = new Map<string, { projectId: string; totalCost: number; recordCount: number }>()
  for (const row of usageCosts) {
    const current = byProjectMap.get(row.projectId) || {
      projectId: row.projectId,
      totalCost: 0,
      recordCount: 0,
    }
    current.totalCost += toMoneyNumber(row.cost)
    current.recordCount += 1
    byProjectMap.set(row.projectId, current)
  }

  return {
    userId,
    currency: BILLING_CURRENCY,
    total: Array.from(byProjectMap.values()).reduce((sum, project) => sum + project.totalCost, 0),
    byProject: Array.from(byProjectMap.values())
      .map((project) => ({
        projectId: project.projectId,
        projectName: projectMap.get(project.projectId) || '未知项目',
        totalCost: project.totalCost,
        recordCount: project.recordCount,
      }))
      .sort((a, b) => b.totalCost - a.totalCost),
  }
}

async function buildTransactions(userId: string) {
  const transactionsRaw = await prisma.balanceTransaction.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 6,
  })
  const visibleTransactions = transactionsRaw.filter((item) => !isInternalTransaction(item))
  const projectIds = [...new Set(visibleTransactions.map((item) => item.projectId).filter(Boolean) as string[])]
  const episodeIds = [...new Set(visibleTransactions.map((item) => item.episodeId).filter(Boolean) as string[])]
  const [projects, episodes] = await Promise.all([
    projectIds.length > 0
      ? prisma.project.findMany({
        where: {
          id: { in: projectIds },
          userId,
        },
        select: { id: true, name: true },
      })
      : Promise.resolve([]),
    episodeIds.length > 0
      ? prisma.novelPromotionEpisode.findMany({
        where: {
          id: { in: episodeIds },
          novelPromotionProject: {
            project: {
              userId,
            },
          },
        },
        select: { id: true, episodeNumber: true, name: true },
      })
      : Promise.resolve([]),
  ])
  const projectMap = new Map(projects.map((project) => [project.id, project.name]))
  const episodeMap = new Map(episodes.map((episode) => [episode.id, { episodeNumber: episode.episodeNumber, name: episode.name }]))

  return visibleTransactions.map((item) => {
    const billingMeta = parseJsonRecord(item.billingMeta ?? null)

    return {
      ...item,
      amount: toMoneyNumber(item.amount),
      balanceAfter: toMoneyNumber(item.balanceAfter),
      action: item.taskType ?? extractActionFromDescription(item.description),
      projectName: item.projectId ? (projectMap.get(item.projectId) ?? null) : null,
      episodeNumber: item.episodeId ? (episodeMap.get(item.episodeId)?.episodeNumber ?? null) : null,
      episodeName: item.episodeId ? (episodeMap.get(item.episodeId)?.name ?? null) : null,
      billingMeta,
      createdAt: item.createdAt.toISOString(),
    }
  })
}

function buildPricingSummary() {
  const entries = listBuiltinPricingCatalog()
  return {
    success: true,
    currency: BILLING_CURRENCY,
    version: BUILTIN_PRICING_VERSION,
    totalModels: entries.length,
    byApiType: API_TYPES.map((apiType) => {
      const matched = entries.filter((entry) => entry.apiType === apiType)
      const amounts = matched.flatMap(pricingAmounts).filter((amount) => Number.isFinite(amount))
      return {
        apiType,
        providerCount: new Set(matched.map((entry) => entry.provider)).size,
        modelCount: matched.length,
        minAmount: amounts.length > 0 ? Math.min(...amounts) : null,
        maxAmount: amounts.length > 0 ? Math.max(...amounts) : null,
      }
    }),
  }
}

export async function buildServiceRecordsOverview(userId: string, options: BuildServiceRecordsOverviewOptions = {}) {
  const taskLimit = normalizeTaskLimit(options.limit)
  const taskReadLimit = resolveTaskReadLimit(taskLimit)
  const [tasksRaw, balance, visibleTotalSpent, transactions, usageCostsRaw] = await Promise.all([
    readTaskRows(userId, taskReadLimit),
    getBalance(userId),
    getVisibleUserTotalSpent(userId),
    buildTransactions(userId),
    readUsageCosts(userId),
  ])
  const visibleTasks = tasksRaw.filter((task) => !isInternalTask(task))
  const tasks = visibleTasks.slice(0, taskLimit)
  const usageCosts = usageCostsRaw.filter((row) => !isInternalUsageCost(row))
  const costs = await buildCostSummary(userId, usageCosts)
  const usageRows = buildUsageRows(tasks, usageCosts)
  const dailyUsage = buildDailyUsage(tasks, usageCosts)
  const usageSummary = buildUsageSummary(tasks, usageCosts, usageRows)

  return {
    success: true,
    source: 'service-records-overview',
    taskWindow: {
      limit: taskLimit,
      readLimit: taskReadLimit,
      rawCount: tasksRaw.length,
      filteredInternalCount: tasksRaw.length - visibleTasks.length,
      returnedCount: tasks.length,
      hasMore: visibleTasks.length > tasks.length,
    },
    tasks,
    balance: {
      success: true,
      currency: BILLING_CURRENCY,
      balance: balance.balance,
      frozenAmount: balance.frozenAmount,
      totalSpent: visibleTotalSpent,
    },
    costs,
    transactions,
    pricing: buildPricingSummary(),
    stats: buildStats(tasks),
    recentFailures: tasks.filter((task) => task.status === 'failed' && taskErrorMessage(task)).slice(0, 3),
    usageRows,
    dailyUsage,
    usageSummary,
    serviceConfigRows: buildServiceConfigRows(tasks),
  }
}
