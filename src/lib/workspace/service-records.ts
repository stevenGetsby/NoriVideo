import { prisma } from '@/lib/prisma'
import { getBalance } from '@/lib/billing'
import { getVisibleUserTotalSpent } from '@/lib/billing/reporting'
import { BILLING_CURRENCY } from '@/lib/billing/currency'
import { toMoneyNumber } from '@/lib/billing/money'
import { cnyToPoints } from '@/lib/billing/credit-policy'
import { calculateUsageCost } from '@/lib/platform-services/usage-cost'
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
    take: 5_000,
  })
}

type ReportProject = {
  id: string
  name: string
  workId: string
  work: { id: string; name: string }
}

type ReportAccount = {
  id: string
  name: string
  role: string
  roleLabel: string | null
}

type RawServiceUsage = {
  id: bigint | number | string
  userId: string | null
  projectId: string | null
  modelKey: string | null
  serviceType: string
  operation: string
  status: string
  inputTokens: number
  outputTokens: number
  units: number | { toString(): string }
  metadata?: unknown
  createdAt: Date
}

function reportDay(value: Date) {
  return value.toISOString().slice(0, 10)
}

function reportApiType(value: string) {
  if (value === 'llm' || value === 'video-repaint') return 'text'
  if (value === 'audio') return 'voice'
  return value || 'other'
}

function reportModelLabel(value: string | null) {
  const source = value?.trim() || '未记录模型'
  const last = source.includes('::') ? source.split('::').pop() || source : source
  return last.replace(/^ep-[a-z0-9-]+$/i, '方舟接入点').replace(/[-_]+/g, ' ')
}

function estimateServiceUsageCost(row: RawServiceUsage) {
  return calculateUsageCost({
    modelKey: row.modelKey,
    serviceType: row.serviceType,
    operation: row.operation,
    status: row.status,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    units: row.units,
    metadata: row.metadata,
  })
}

function usageBucket(userId: string | null, projectId: string | null, apiType: string, model: string | null, createdAt: Date) {
  return [userId || 'system', projectId || 'workspace', reportApiType(apiType), model || 'unknown', reportDay(createdAt)].join('\u0000')
}

async function buildFilterableReport(userId: string) {
  const prismaModels = prisma as unknown as {
    user?: { findMany(args: unknown): Promise<ReportAccount[]> }
    project?: { findMany(args: unknown): Promise<ReportProject[]> }
    serviceUsageRecord?: { findMany(args: unknown): Promise<RawServiceUsage[]> }
  }
  if (!prismaModels.user?.findMany || !prismaModels.project?.findMany || !prismaModels.serviceUsageRecord?.findMany) {
    return {
      records: [],
      options: { works: [], projects: [], accounts: [], services: [], models: [] },
      generatedAt: new Date().toISOString(),
    }
  }

  const since = new Date(Date.now() - 180 * 24 * 60 * 60 * 1_000)
  const [accounts, projects] = await Promise.all([
    prismaModels.user.findMany({
      where: { OR: [{ id: userId }, { workspaceOwnerId: userId }], status: 'active' },
      select: { id: true, name: true, role: true, roleLabel: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    }),
    prismaModels.project.findMany({
      where: { userId },
      select: { id: true, name: true, workId: true, work: { select: { id: true, name: true } } },
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
    }),
  ])
  const accountIds = accounts.map((account) => account.id)
  const [rawRecords, teamUsageCostsRaw] = accountIds.length > 0
    ? await Promise.all([
      prismaModels.serviceUsageRecord.findMany({
        where: { userId: { in: accountIds }, createdAt: { gte: since } },
        select: {
          id: true,
          userId: true,
          projectId: true,
          modelKey: true,
          serviceType: true,
          operation: true,
          status: true,
          inputTokens: true,
          outputTokens: true,
          units: true,
          metadata: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 5_000,
      }),
      prisma.usageCost.findMany({
        where: { userId: { in: accountIds }, createdAt: { gte: since } },
        orderBy: { createdAt: 'desc' },
        take: 5_000,
      }),
    ])
    : [[], []] as [RawServiceUsage[], UsageCostRow[]]
  const teamUsageCosts = teamUsageCostsRaw.filter((row) => !isInternalUsageCost(row))

  const accountMap = new Map(accounts.map((account) => [account.id, account]))
  const projectMap = new Map(projects.map((project) => [project.id, project]))
  const billedBuckets = new Map<string, { total: number; remaining: number; count: number }>()
  for (const row of teamUsageCosts) {
    const key = usageBucket(row.userId, row.projectId, row.apiType, row.model, row.createdAt)
    const current = billedBuckets.get(key) || { total: 0, remaining: 0, count: 0 }
    const amount = toMoneyNumber(row.cost)
    current.total += amount
    current.remaining += amount
    current.count += 1
    billedBuckets.set(key, current)
  }
  const serviceBucketCounts = new Map<string, number>()
  for (const row of rawRecords) {
    if (row.status === 'failed') continue
    const key = usageBucket(row.userId, row.projectId, row.serviceType, row.modelKey, row.createdAt)
    serviceBucketCounts.set(key, (serviceBucketCounts.get(key) || 0) + 1)
  }

  const consumedBillingBuckets = new Set<string>()
  const records = rawRecords.map((row) => {
    const key = usageBucket(row.userId, row.projectId, row.serviceType, row.modelKey, row.createdAt)
    const billed = billedBuckets.get(key)
    const divisor = Math.max(1, serviceBucketCounts.get(key) || 1)
    const actualShare = billed ? billed.total / divisor : null
    if (billed) consumedBillingBuckets.add(key)
    const cost = row.status === 'failed' ? 0 : Math.max(0, actualShare ?? estimateServiceUsageCost(row))
    const project = row.projectId ? projectMap.get(row.projectId) : null
    const account = row.userId ? accountMap.get(row.userId) : null
    return {
      id: String(row.id),
      projectId: project?.id || null,
      projectName: project?.name || '工作区服务',
      workId: project?.work.id || null,
      workName: project?.work.name || '未归属作品',
      accountId: account?.id || null,
      accountName: account?.name || '系统任务',
      accountRole: account?.roleLabel || account?.role || '',
      serviceType: reportApiType(row.serviceType),
      operation: row.operation,
      modelKey: row.modelKey || 'unknown',
      modelName: reportModelLabel(row.modelKey),
      status: row.status === 'failed' ? 'failed' : 'success',
      inputTokens: Math.max(0, row.inputTokens || 0),
      outputTokens: Math.max(0, row.outputTokens || 0),
      units: Math.max(0, Number(row.units) || 0),
      cost,
      points: cnyToPoints(cost),
      createdAt: row.createdAt.toISOString(),
    }
  })

  // Older records may predate service-level telemetry. Preserve their real
  // billing amount as a friendly report row instead of silently dropping it.
  for (const row of teamUsageCosts) {
    const key = usageBucket(row.userId, row.projectId, row.apiType, row.model, row.createdAt)
    if (consumedBillingBuckets.has(key)) continue
    const project = projectMap.get(row.projectId)
    const account = accountMap.get(row.userId)
    const tokens = usageTokenCounts(row.metadata)
    const cost = Math.max(0, toMoneyNumber(row.cost))
    records.push({
      id: `billing-${row.id}`,
      projectId: project?.id || null,
      projectName: project?.name || '工作区服务',
      workId: project?.work.id || null,
      workName: project?.work.name || '未归属作品',
      accountId: account?.id || null,
      accountName: account?.name || '管理账号',
      accountRole: account?.roleLabel || account?.role || '',
      serviceType: reportApiType(row.apiType),
      operation: row.action,
      modelKey: row.model || 'unknown',
      modelName: reportModelLabel(row.model),
      status: 'success',
      inputTokens: tokens.inputTokens,
      outputTokens: tokens.outputTokens,
      units: Math.max(0, row.quantity || 0),
      cost,
      points: cnyToPoints(cost),
      createdAt: row.createdAt.toISOString(),
    })
  }
  records.sort((left, right) => right.createdAt.localeCompare(left.createdAt))

  const services = Array.from(new Set(records.map((record) => record.serviceType))).sort()
  const models = Array.from(new Map(records.map((record) => [record.modelKey, {
    id: record.modelKey,
    name: record.modelName,
  }])).values()).sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'))
  const works = Array.from(new Map(projects.map((project) => [project.work.id, project.work])).values())

  return {
    records,
    options: {
      works,
      projects: projects.map((project) => ({ id: project.id, name: project.name, workId: project.workId })),
      accounts: accounts.map((account) => ({
        id: account.id,
        name: account.name,
        role: account.roleLabel || account.role,
      })),
      services,
      models,
    },
    generatedAt: new Date().toISOString(),
  }
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

function usageTokenCounts(metadata: string | null) {
  const parsed = parseJsonRecord(metadata) || {}
  const inputTokens = Number(parsed.inputTokens ?? parsed.input_tokens ?? 0)
  const outputTokens = Number(parsed.outputTokens ?? parsed.output_tokens ?? 0)
  return {
    inputTokens: Number.isFinite(inputTokens) ? Math.max(0, Math.floor(inputTokens)) : 0,
    outputTokens: Number.isFinite(outputTokens) ? Math.max(0, Math.floor(outputTokens)) : 0,
  }
}

function buildUsageRows(tasks: ServiceTask[], usageCosts: UsageCostRow[]) {
  if (usageCosts.length > 0) {
    const rows = new Map<string, {
      id: string
      key: string
      apiType: string
      unit: string
      total: number
      completed: number
      failed: number
      units: number
      cost: number
      inputTokens: number
      outputTokens: number
    }>()
    for (const row of usageCosts) {
      const key = row.action || row.apiType || 'unknown'
      const apiType = row.apiType || 'unknown'
      const unit = row.unit || 'unit'
      const id = `${key}:${apiType}:${unit}`
      const current = rows.get(id) || {
        id,
        key,
        apiType,
        unit,
        total: 0,
        completed: 0,
        failed: 0,
        units: 0,
        cost: 0,
        inputTokens: 0,
        outputTokens: 0,
      }
      const tokens = usageTokenCounts(row.metadata)
      current.total += 1
      current.completed += 1
      current.units += row.quantity || 0
      current.cost += toMoneyNumber(row.cost)
      current.inputTokens += tokens.inputTokens
      current.outputTokens += tokens.outputTokens
      rows.set(id, current)
    }
    return Array.from(rows.values())
      .sort((a, b) => b.cost - a.cost || b.units - a.units || b.total - a.total)
      .slice(0, 6)
  }

  const rows = new Map<string, {
    id: string
    key: string
    apiType: string
    unit: string
    total: number
    completed: number
    failed: number
    units: number
    cost: number
    inputTokens: number
    outputTokens: number
  }>()
  for (const task of tasks) {
    const key = task.type || task.targetType || 'unknown'
    const current = rows.get(key) || {
      id: key,
      key,
      apiType: 'task',
      unit: 'run',
      total: 0,
      completed: 0,
      failed: 0,
      units: 0,
      cost: 0,
      inputTokens: 0,
      outputTokens: 0,
    }
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
  const rows = new Map<string, {
    day: string
    total: number
    units: number
    cost: number
    inputTokens: number
    outputTokens: number
  }>()
  if (usageCosts.length > 0) {
    for (const row of usageCosts) {
      const day = usageCostDay(row)
      const current = rows.get(day) || {
        day,
        total: 0,
        units: 0,
        cost: 0,
        inputTokens: 0,
        outputTokens: 0,
      }
      const tokens = usageTokenCounts(row.metadata)
      current.total += 1
      current.units += row.quantity || 0
      current.cost += toMoneyNumber(row.cost)
      current.inputTokens += tokens.inputTokens
      current.outputTokens += tokens.outputTokens
      rows.set(day, current)
    }
    return Array.from(rows.values()).slice(0, 7)
  }

  for (const task of tasks) {
    const day = taskDay(task)
    const current = rows.get(day) || {
      day,
      total: 0,
      units: 0,
      cost: 0,
      inputTokens: 0,
      outputTokens: 0,
    }
    current.total += 1
    current.units += estimateUnits(task)
    rows.set(day, current)
  }
  return Array.from(rows.values()).slice(0, 7)
}

function buildUsageSummary(tasks: ServiceTask[], usageCosts: UsageCostRow[], usageRows: Array<{ key: string }>) {
  if (usageCosts.length > 0) {
    const tokens = usageCosts.reduce((total, row) => {
      const current = usageTokenCounts(row.metadata)
      return {
        inputTokens: total.inputTokens + current.inputTokens,
        outputTokens: total.outputTokens + current.outputTokens,
      }
    }, { inputTokens: 0, outputTokens: 0 })
    return {
      source: 'billing' as const,
      billableTasks: usageCosts.length,
      estimatedUnits: usageCosts.reduce((sum, row) => sum + (row.quantity || 0), 0),
      totalCost: usageCosts.reduce((sum, row) => sum + toMoneyNumber(row.cost), 0),
      inputTokens: tokens.inputTokens,
      outputTokens: tokens.outputTokens,
      serviceTypes: usageRows.length,
    }
  }

  const billableTasks = tasks.filter(isBillableTask)
  return {
    source: 'tasks' as const,
    billableTasks: billableTasks.length,
    estimatedUnits: billableTasks.reduce((sum, task) => sum + estimateUnits(task), 0),
    totalCost: 0,
    inputTokens: 0,
    outputTokens: 0,
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
  const report = await buildFilterableReport(userId)

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
    report,
  }
}
