'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import { apiFetch } from '@/lib/api-fetch'

interface ServiceTaskError {
  message?: string | null
}

interface ServiceTask {
  id: string
  projectId: string
  episodeId?: string | null
  type: string
  targetType: string
  targetId: string
  status: string
  progress: number
  error?: ServiceTaskError | null
  errorMessage?: string | null
  queuedAt?: string | null
  startedAt?: string | null
  finishedAt?: string | null
  createdAt: string
  updatedAt: string
}

interface BalanceResponse {
  currency?: string
  balance?: number
  frozenAmount?: number
  totalSpent?: number
}

interface CostProjectRow {
  projectId: string
  projectName: string
  totalCost: number
  recordCount: number
}

interface CostsResponse {
  currency?: string
  total?: number
  byProject?: CostProjectRow[]
}

interface BillingTransaction {
  id: string
  type: string
  amount: number
  balanceAfter?: number | null
  description?: string | null
  action?: string | null
  projectName?: string | null
  episodeNumber?: number | null
  createdAt: string
}

interface PricingApiTypeRow {
  apiType: string
  providerCount: number
  modelCount: number
  minAmount: number | null
  maxAmount: number | null
}

interface PricingResponse {
  currency?: string
  version?: string
  totalModels?: number
  byApiType?: PricingApiTypeRow[]
}

interface ServiceStats {
  all: number
  processing: number
  completed: number
  failed: number
}

interface UsageRow {
  key: string
  total: number
  completed: number
  failed: number
  units: number
}

interface DailyUsageRow {
  day: string
  total: number
  units: number
}

interface UsageSummary {
  billableTasks: number
  estimatedUnits: number
  serviceTypes: number
}

interface ServiceConfigRow {
  id: string
  apiType: string
  unitCost: number
  total: number
  completed: number
  failed: number
  successRate: number
  enabled: boolean
}

interface ServiceRecordsResponse {
  tasks?: ServiceTask[]
  balance?: BalanceResponse
  costs?: CostsResponse
  transactions?: BillingTransaction[]
  pricing?: PricingResponse
  stats?: ServiceStats
  recentFailures?: ServiceTask[]
  usageRows?: UsageRow[]
  dailyUsage?: DailyUsageRow[]
  usageSummary?: UsageSummary
  serviceConfigRows?: ServiceConfigRow[]
}

const STATUS_CLASSES: Record<string, string> = {
  queued: 'border-[#7eb0ff]/30 bg-[#2c6ef2]/10 text-[#9bc3ff]',
  processing: 'border-[#ffcc66]/35 bg-[#ffcc66]/10 text-[#ffd98a]',
  completed: 'border-[#45d483]/30 bg-[#45d483]/10 text-[#8ff0b9]',
  failed: 'border-[#ff6b6b]/35 bg-[#ff6b6b]/10 text-[#ff9a9a]',
  canceled: 'border-white/15 bg-white/6 text-white/56',
}

const KNOWN_STATUSES = new Set(['queued', 'processing', 'completed', 'failed', 'canceled'])
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

const INTERNAL_TASK_PATTERN = /(?:^|[^A-Za-z0-9])(?:NORI_AGENT[\w-]*|super[_\s-]?agent[\w-]*)|自动创作模式/i

const SERVICE_CONFIGS = [
  { id: 'video', apiType: 'video', matcher: /video|seedance/i, unitCost: 6 },
  { id: 'image', apiType: 'image', matcher: /image|storyboard|character|location/i, unitCost: 1 },
  { id: 'voice', apiType: 'voice', matcher: /voice|tts|audio/i, unitCost: 2 },
  { id: 'text', apiType: 'text', matcher: /script|clip|analysis|llm|text/i, unitCost: 1 },
]

function formatDate(value?: string | null) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleString()
}

function formatMoney(value?: number | null, currency = 'CNY') {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-'
  const prefix = currency === 'CNY' ? '¥' : `${currency} `
  return `${prefix}${value.toFixed(2)}`
}

function formatPriceRange(row?: PricingApiTypeRow, currency = 'CNY') {
  if (!row || typeof row.minAmount !== 'number' || typeof row.maxAmount !== 'number') return '-'
  if (row.minAmount === row.maxAmount) return formatMoney(row.minAmount, currency)
  return `${formatMoney(row.minAmount, currency)}-${formatMoney(row.maxAmount, currency)}`
}

function taskErrorMessage(task: ServiceTask) {
  return task.error?.message || task.errorMessage || ''
}

function isInternalTask(task: ServiceTask) {
  return INTERNAL_TASK_PATTERN.test(`${task.type} ${task.targetType} ${taskErrorMessage(task)}`)
}

function taskTimestamp(task: ServiceTask) {
  return task.finishedAt || task.updatedAt || task.startedAt || task.queuedAt || task.createdAt
}

function taskDay(task: ServiceTask) {
  const date = new Date(taskTimestamp(task))
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleDateString()
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

export function FrameServiceRecordsDashboard() {
  const t = useTranslations('workspace.serviceRecordsPanel')
  const [tasks, setTasks] = useState<ServiceTask[]>([])
  const [balance, setBalance] = useState<BalanceResponse | null>(null)
  const [costs, setCosts] = useState<CostsResponse | null>(null)
  const [transactions, setTransactions] = useState<BillingTransaction[]>([])
  const [pricing, setPricing] = useState<PricingResponse | null>(null)
  const [serverStats, setServerStats] = useState<ServiceStats | null>(null)
  const [serverRecentFailures, setServerRecentFailures] = useState<ServiceTask[] | null>(null)
  const [serverUsageRows, setServerUsageRows] = useState<UsageRow[] | null>(null)
  const [serverDailyUsage, setServerDailyUsage] = useState<DailyUsageRow[] | null>(null)
  const [serverUsageSummary, setServerUsageSummary] = useState<UsageSummary | null>(null)
  const [serverServiceConfigRows, setServerServiceConfigRows] = useState<ServiceConfigRow[] | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [billingError, setBillingError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function loadOverview() {
      setIsLoading(true)
      setError(null)
      setBillingError(null)
      try {
        const response = await apiFetch('/api/service-records')
        if (!response.ok) {
          throw new Error(`${response.status} ${response.statusText}`.trim())
        }
        const data = (await response.json()) as ServiceRecordsResponse
        if (!cancelled) {
          setTasks(Array.isArray(data.tasks) ? data.tasks : [])
          setBalance(data.balance || null)
          setCosts(data.costs || null)
          setTransactions(Array.isArray(data.transactions) ? data.transactions : [])
          setPricing(data.pricing || null)
          setServerStats(data.stats || null)
          setServerRecentFailures(Array.isArray(data.recentFailures) ? data.recentFailures : null)
          setServerUsageRows(Array.isArray(data.usageRows) ? data.usageRows : null)
          setServerDailyUsage(Array.isArray(data.dailyUsage) ? data.dailyUsage : null)
          setServerUsageSummary(data.usageSummary || null)
          setServerServiceConfigRows(Array.isArray(data.serviceConfigRows) ? data.serviceConfigRows : null)
        }
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : t('loadFailed'))
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    loadOverview()
    return () => {
      cancelled = true
    }
  }, [t])

  const visibleTasks = useMemo(() => tasks.filter((task) => !isInternalTask(task)), [tasks])

  const stats = useMemo(() => {
    if (serverStats) return serverStats
    const totals = {
      all: visibleTasks.length,
      processing: 0,
      completed: 0,
      failed: 0,
    }
    for (const task of visibleTasks) {
      if (task.status === 'queued' || task.status === 'processing') totals.processing += 1
      if (task.status === 'completed') totals.completed += 1
      if (task.status === 'failed') totals.failed += 1
    }
    return totals
  }, [serverStats, visibleTasks])

  const recentFailures = useMemo(
    () => serverRecentFailures ?? visibleTasks.filter((task) => task.status === 'failed' && taskErrorMessage(task)).slice(0, 3),
    [serverRecentFailures, visibleTasks],
  )

  const usageRows = useMemo(() => {
    if (serverUsageRows) return serverUsageRows
    const rows = new Map<string, { key: string; total: number; completed: number; failed: number; units: number }>()
    for (const task of visibleTasks) {
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
  }, [serverUsageRows, visibleTasks])

  const dailyUsage = useMemo(() => {
    if (serverDailyUsage) return serverDailyUsage
    const rows = new Map<string, { day: string; total: number; units: number }>()
    for (const task of visibleTasks) {
      const day = taskDay(task)
      const current = rows.get(day) || { day, total: 0, units: 0 }
      current.total += 1
      current.units += estimateUnits(task)
      rows.set(day, current)
    }
    return Array.from(rows.values()).slice(0, 7)
  }, [serverDailyUsage, visibleTasks])

  const usageSummary = useMemo(() => {
    if (serverUsageSummary) return serverUsageSummary
    const billableTasks = visibleTasks.filter(isBillableTask)
    const estimatedUnits = billableTasks.reduce((sum, task) => sum + estimateUnits(task), 0)
    return {
      billableTasks: billableTasks.length,
      estimatedUnits,
      serviceTypes: usageRows.length,
    }
  }, [serverUsageSummary, usageRows.length, visibleTasks])

  const serviceConfigRows = useMemo(() => (
    serverServiceConfigRows ?? SERVICE_CONFIGS.map((config) => {
      const matchedTasks = visibleTasks.filter((task) => config.matcher.test(`${task.type} ${task.targetType}`))
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
  ), [serverServiceConfigRows, visibleTasks])

  const billingCurrency = balance?.currency || costs?.currency || 'CNY'
  const pricingCurrency = pricing?.currency || billingCurrency
  const pricingByApiType = new Map((pricing?.byApiType || []).map((row) => [row.apiType, row]))
  const topCostProjects = (costs?.byProject || []).slice(0, 3)

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-white/10 bg-[#151820] p-4 shadow-[0_18px_50px_rgba(0,0,0,.18)]">
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <AppIcon name="receipt" className="h-4 w-4 text-[#7eb0ff]" />
            {t('title')}
          </div>
          <p className="mt-1 text-xs leading-5 text-white/45">{t('subtitle')}</p>
        </div>
        <div className="grid grid-cols-4 gap-2 text-center">
          {(['all', 'processing', 'completed', 'failed'] as const).map((key) => (
            <div key={key} className="rounded-md border border-white/10 bg-white/4 px-3 py-2">
              <div className="text-base font-bold text-white">{stats[key]}</div>
              <div className="mt-0.5 text-[11px] text-white/42">{t(`stats.${key}`)}</div>
            </div>
          ))}
        </div>
      </div>

      {error ? (
        <div className="mb-4 rounded-md border border-[#ff6b6b]/30 bg-[#ff6b6b]/10 px-3 py-2 text-sm text-[#ffb1b1]">
          {t('loadFailed')}: {error}
        </div>
      ) : null}

      <div className="mb-4 rounded-md border border-white/10 bg-white/4 p-3">
        <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-white/76">
              <AppIcon name="coins" className="h-4 w-4 text-[#ffd98a]" />
              {t('billing.realTitle')}
            </div>
            <div className="mt-1 text-xs leading-5 text-white/38">{t('billing.realSubtitle')}</div>
          </div>
          <span className="w-fit rounded bg-emerald-400/10 px-2 py-0.5 text-[11px] text-emerald-200">
            {t('billing.realSource')}
          </span>
        </div>

        {billingError ? (
          <div className="rounded-md border border-white/10 bg-[#10131b] px-3 py-4 text-sm text-white/40">
            {billingError}
          </div>
        ) : (
          <div className="grid gap-3 xl:grid-cols-[360px_1fr_1.1fr]">
            <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-1">
              {[
                { key: 'balance', value: formatMoney(balance?.balance, billingCurrency) },
                { key: 'frozen', value: formatMoney(balance?.frozenAmount, billingCurrency) },
                { key: 'spent', value: formatMoney(balance?.totalSpent ?? costs?.total, billingCurrency) },
              ].map((item) => (
                <div key={item.key} className="rounded-md border border-white/8 bg-[#10131b] px-3 py-2">
                  <div className="text-[11px] text-white/38">{t(`billing.realStats.${item.key}`)}</div>
                  <div className="mt-1 text-lg font-semibold text-white">{item.value}</div>
                </div>
              ))}
            </div>

            <div className="rounded-md border border-white/8 bg-[#10131b] p-3">
              <div className="mb-2 text-xs font-semibold text-white/56">{t('billing.projectCosts')}</div>
              <div className="space-y-2">
                {topCostProjects.length > 0 ? topCostProjects.map((project) => (
                  <div key={project.projectId} className="flex items-center justify-between gap-3 rounded border border-white/8 bg-white/4 px-2 py-2">
                    <div className="min-w-0">
                      <div className="truncate text-xs font-medium text-white/68">{project.projectName}</div>
                      <div className="mt-0.5 text-[11px] text-white/32">{t('billing.records', { count: project.recordCount })}</div>
                    </div>
                    <div className="shrink-0 text-sm font-semibold text-white/72">{formatMoney(project.totalCost, billingCurrency)}</div>
                  </div>
                )) : (
                  <div className="rounded border border-dashed border-white/10 px-3 py-6 text-center text-xs text-white/34">
                    {t('billing.noRealCosts')}
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-md border border-white/8 bg-[#10131b] p-3">
              <div className="mb-2 text-xs font-semibold text-white/56">{t('billing.transactions')}</div>
              <div className="space-y-2">
                {transactions.length > 0 ? transactions.map((item) => (
                  <div key={item.id} className="grid grid-cols-[1fr_auto] gap-3 rounded border border-white/8 bg-white/4 px-2 py-2">
                    <div className="min-w-0">
                      <div className="truncate text-xs font-medium text-white/68">
                        {item.projectName || item.action || item.description || item.type}
                      </div>
                      <div className="mt-0.5 truncate text-[11px] text-white/32">{formatDate(item.createdAt)}</div>
                    </div>
                    <div className={`shrink-0 text-sm font-semibold ${item.amount < 0 ? 'text-[#ffb1b1]' : 'text-emerald-200'}`}>
                      {formatMoney(item.amount, billingCurrency)}
                    </div>
                  </div>
                )) : (
                  <div className="rounded border border-dashed border-white/10 px-3 py-6 text-center text-xs text-white/34">
                    {t('billing.noTransactions')}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="mb-4 grid gap-3 lg:grid-cols-[1fr_340px]">
        <div className="rounded-md border border-white/10 bg-white/4 p-3">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-white/76">
              <AppIcon name="barChart" className="h-4 w-4 text-[#9bc3ff]" />
              {t('usage.title')}
            </div>
            <span className="rounded bg-white/6 px-2 py-0.5 text-[11px] text-white/38">
              {t('usage.estimated')}
            </span>
          </div>
          <div className="grid gap-2 md:grid-cols-3">
            {(['billableTasks', 'estimatedUnits', 'serviceTypes'] as const).map((key) => (
              <div key={key} className="rounded-md border border-white/8 bg-[#10131b] px-3 py-2">
                <div className="text-[11px] text-white/38">{t(`usage.stats.${key}`)}</div>
                <div className="mt-1 text-lg font-semibold text-white">{usageSummary[key]}</div>
              </div>
            ))}
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-7">
            {dailyUsage.length > 0 ? dailyUsage.map((day) => {
              const maxUnits = Math.max(...dailyUsage.map((item) => item.units), 1)
              return (
                <div key={day.day} className="flex min-h-[96px] flex-col justify-end rounded-md border border-white/8 bg-[#10131b] px-2 py-2">
                  <div className="mb-2 flex flex-1 items-end">
                    <div
                      className="w-full rounded-sm bg-[#2c6ef2]"
                      style={{ height: `${Math.max(8, Math.round((day.units / maxUnits) * 56))}px` }}
                    />
                  </div>
                  <div className="truncate text-center text-[10px] text-white/32">{day.day}</div>
                  <div className="text-center text-[11px] font-semibold text-white/62">{day.units}</div>
                </div>
              )
            }) : (
              <div className="rounded-md border border-dashed border-white/10 px-3 py-6 text-sm text-white/38 md:col-span-7">
                {t('usage.empty')}
              </div>
            )}
          </div>
        </div>

        <div className="rounded-md border border-white/10 bg-white/4 p-3">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-white/76">
            <AppIcon name="coins" className="h-4 w-4 text-[#ffd98a]" />
            {t('billing.title')}
          </div>
          <div className="space-y-2">
            {usageRows.length > 0 ? usageRows.map((row) => {
              const successRate = row.total ? Math.round((row.completed / row.total) * 100) : 0
              return (
                <div key={row.key} className="rounded-md border border-white/8 bg-[#10131b] px-3 py-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 truncate text-sm font-medium text-white/76">{row.key}</div>
                    <span className="shrink-0 rounded bg-white/6 px-2 py-0.5 text-[11px] text-white/42">
                      {t('billing.units', { count: row.units })}
                    </span>
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-1 text-center text-[11px]">
                    <span className="rounded bg-white/6 px-2 py-1 text-white/42">{t('billing.total', { count: row.total })}</span>
                    <span className="rounded bg-[#45d483]/10 px-2 py-1 text-[#8ff0b9]">{successRate}%</span>
                    <span className={`rounded px-2 py-1 ${row.failed > 0 ? 'bg-[#ff6b6b]/10 text-[#ff9a9a]' : 'bg-white/6 text-white/34'}`}>
                      {t('billing.failed', { count: row.failed })}
                    </span>
                  </div>
                </div>
              )
            }) : (
              <div className="rounded-md border border-dashed border-white/10 px-3 py-6 text-sm text-white/38">
                {t('billing.empty')}
              </div>
            )}
          </div>
        </div>
      </div>

      {recentFailures.length > 0 ? (
        <div className="mb-4 rounded-md border border-[#ff6b6b]/25 bg-[#ff6b6b]/8 p-3">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-[#ffb1b1]">
            <AppIcon name="alert" className="h-3.5 w-3.5" />
            {t('recentFailures')}
          </div>
          <div className="space-y-2">
            {recentFailures.map((task) => (
              <div key={task.id} className="line-clamp-2 text-xs leading-5 text-white/58">
                <span className="font-mono text-white/72">{task.type}</span>
                <span className="mx-2 text-white/25">/</span>
                {taskErrorMessage(task)}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mb-4 rounded-md border border-white/10 bg-white/4 p-3">
        <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-white/76">
              <AppIcon name="settingsHex" className="h-4 w-4 text-[#9bc3ff]" />
              {t('configMatrix.title')}
            </div>
            <div className="mt-1 text-xs leading-5 text-white/38">{t('configMatrix.subtitle')}</div>
          </div>
          <span className="w-fit rounded bg-white/6 px-2 py-0.5 text-[11px] text-white/38">
            {pricing?.version ? t('configMatrix.pricingVersion', { version: pricing.version }) : t('configMatrix.derived')}
          </span>
        </div>
        <div className="overflow-hidden rounded-md border border-white/10">
          <div className="grid grid-cols-[1fr_.75fr_.75fr_.75fr_.75fr] gap-3 border-b border-white/10 bg-[#10131b] px-3 py-2 text-xs font-medium text-white/45">
            <div>{t('configMatrix.table.service')}</div>
            <div>{t('configMatrix.table.priceRange')}</div>
            <div>{t('configMatrix.table.successRate')}</div>
            <div>{t('configMatrix.table.usage')}</div>
            <div>{t('configMatrix.table.status')}</div>
          </div>
          <div className="divide-y divide-white/8">
            {serviceConfigRows.map((row) => {
              const pricingRow = pricingByApiType.get(row.apiType)
              return (
                <div key={row.id} className="grid grid-cols-[1fr_.75fr_.75fr_.75fr_.75fr] gap-3 px-3 py-3 text-sm">
                  <div className="min-w-0">
                    <div className="truncate font-medium text-white/78">{t(`configMatrix.services.${row.id}.title`)}</div>
                    <div className="mt-0.5 truncate text-[11px] text-white/34">
                      {pricingRow
                        ? t('configMatrix.modelCoverage', { providers: pricingRow.providerCount, models: pricingRow.modelCount })
                        : t(`configMatrix.services.${row.id}.hint`)}
                    </div>
                  </div>
                  <div className="text-white/58">{formatPriceRange(pricingRow, pricingCurrency)}</div>
                  <div className="text-white/58">{row.successRate}%</div>
                  <div className="text-white/58">{t('configMatrix.runs', { count: row.total })}</div>
                  <div>
                    <span className={`inline-flex rounded border px-2 py-1 text-xs ${
                      row.enabled
                        ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-200'
                        : 'border-white/12 bg-white/6 text-white/38'
                    }`}>
                      {row.enabled ? t('configMatrix.enabled') : t('configMatrix.standby')}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-md border border-white/10">
        <div className="grid grid-cols-[1.2fr_.8fr_.8fr_.7fr_.9fr] gap-3 border-b border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-white/45">
          <div>{t('table.type')}</div>
          <div>{t('table.target')}</div>
          <div>{t('table.status')}</div>
          <div>{t('table.progress')}</div>
          <div>{t('table.updatedAt')}</div>
        </div>
        {isLoading ? (
          <div className="flex items-center gap-2 px-3 py-6 text-sm text-white/52">
            <AppIcon name="loader" className="h-4 w-4 animate-spin" />
            {t('loading')}
          </div>
        ) : visibleTasks.length === 0 ? (
          <div className="px-3 py-6 text-sm text-white/45">{t('empty')}</div>
        ) : (
          <div className="divide-y divide-white/8">
            {visibleTasks.slice(0, 12).map((task) => (
              <div key={task.id} className="grid grid-cols-[1.2fr_.8fr_.8fr_.7fr_.9fr] gap-3 px-3 py-3 text-sm">
                <div className="min-w-0">
                  <div className="truncate font-medium text-white/78">{task.type}</div>
                  <div className="mt-0.5 truncate font-mono text-[11px] text-white/32">{task.id}</div>
                </div>
                <div className="min-w-0">
                  <div className="truncate text-white/62">{task.targetType}</div>
                  <div className="mt-0.5 truncate font-mono text-[11px] text-white/32">{task.targetId}</div>
                </div>
                <div>
                  <span className={`inline-flex rounded border px-2 py-1 text-xs ${STATUS_CLASSES[task.status] || STATUS_CLASSES.canceled}`}>
                    {KNOWN_STATUSES.has(task.status) ? t(`status.${task.status}`) : task.status}
                  </span>
                </div>
                <div className="text-white/62">{Math.max(0, Math.min(100, task.progress || 0))}%</div>
                <div className="text-xs text-white/45">{formatDate(task.updatedAt || task.finishedAt || task.createdAt)}</div>
              </div>
            ))}
          </div>
        )}
      </div>
      </section>
    </div>
  )
}
