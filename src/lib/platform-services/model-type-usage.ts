import { toMoneyNumber, roundMoney, type MoneyValue } from '@/lib/billing/money'
import { isInternalUsageCostRecord } from '@/lib/workspace/internal-record-visibility'

export const MODEL_USAGE_TYPES = ['text', 'image', 'video', 'audio'] as const
export type ModelUsageType = (typeof MODEL_USAGE_TYPES)[number]

export const MODEL_USAGE_TYPE_LABELS: Record<ModelUsageType, string> = {
  text: '文本',
  image: '图片',
  video: '视频',
  audio: '语音',
}

export type ModelTypeUsage = {
  type: ModelUsageType
  label: string
  calls: number
  cost: number
  lastUsedAt: string | null
}

export type ModelUsageSummary = {
  calls: number
  cost: number
  lastUsedAt: string | null
  byType: ModelTypeUsage[]
}

export type ModelUsageCostRow = {
  userId?: string | null
  apiType?: string | null
  serviceType?: string | null
  model?: string | null
  action?: string | null
  metadata?: string | null
  cost?: MoneyValue
  createdAt?: Date | string | null
}

export function normalizeModelUsageType(value: string | null | undefined): ModelUsageType | null {
  const key = (value || '').trim().toLowerCase()
  if (key === 'text' || key === 'llm' || key === 'video-repaint') return 'text'
  if (key === 'image') return 'image'
  if (key === 'video') return 'video'
  if (
    key === 'audio'
    || key === 'voice'
    || key === 'voice-design'
    || key === 'lip-sync'
    || key === 'lipsync'
  ) {
    return 'audio'
  }
  return null
}

export function emptyModelTypeUsage(type: ModelUsageType): ModelTypeUsage {
  return {
    type,
    label: MODEL_USAGE_TYPE_LABELS[type],
    calls: 0,
    cost: 0,
    lastUsedAt: null,
  }
}

export function emptyModelUsageSummary(): ModelUsageSummary {
  return {
    calls: 0,
    cost: 0,
    lastUsedAt: null,
    byType: MODEL_USAGE_TYPES.map(emptyModelTypeUsage),
  }
}

export function formatUsageMoney(value: number) {
  return `¥${(Number.isFinite(value) ? value : 0).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  })}`
}

function laterTimestamp(left: string | null, right: string | null) {
  if (!right) return left
  if (!left || right > left) return right
  return left
}

export function addModelUsage(
  target: ModelUsageSummary,
  type: ModelUsageType,
  input: { calls?: number; cost?: number; lastUsedAt?: string | null },
) {
  const row = target.byType.find((item) => item.type === type)
  if (!row) return
  const calls = Math.max(0, Math.floor(input.calls || 0))
  const cost = toMoneyNumber(input.cost)
  row.calls += calls
  row.cost = roundMoney(row.cost + cost)
  row.lastUsedAt = laterTimestamp(row.lastUsedAt, input.lastUsedAt || null)
  target.calls += calls
  target.cost = roundMoney(target.cost + cost)
  target.lastUsedAt = laterTimestamp(target.lastUsedAt, input.lastUsedAt || null)
}

export function mergeModelUsageSummaries(rows: ModelUsageSummary[]): ModelUsageSummary {
  const result = emptyModelUsageSummary()
  for (const row of rows) {
    for (const item of row.byType) {
      addModelUsage(result, item.type, item)
    }
  }
  return result
}

function usageTimestamp(value: Date | string | null | undefined) {
  if (!value) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

export function accumulateModelUsageCost(target: ModelUsageSummary, row: ModelUsageCostRow) {
  if (isInternalUsageCostRecord(row)) return
  const type = normalizeModelUsageType(row.apiType || row.serviceType)
  if (!type) return
  addModelUsage(target, type, {
    calls: 1,
    cost: toMoneyNumber(row.cost),
    lastUsedAt: usageTimestamp(row.createdAt),
  })
}

export function buildModelUsageByAccount(rows: ModelUsageCostRow[]): Map<string, ModelUsageSummary> {
  const usage = new Map<string, ModelUsageSummary>()
  for (const row of rows) {
    if (!row.userId) continue
    const current = usage.get(row.userId) || emptyModelUsageSummary()
    accumulateModelUsageCost(current, row)
    usage.set(row.userId, current)
  }
  return usage
}

export function summarizeUsageRowsByType(
  rows: Array<{ serviceType?: string | null; calls?: number; cost?: number; lastUsedAt?: string | null }>,
): ModelUsageSummary {
  const summary = emptyModelUsageSummary()
  for (const row of rows) {
    const type = normalizeModelUsageType(row.serviceType)
    if (!type) continue
    addModelUsage(summary, type, {
      calls: row.calls,
      cost: row.cost,
      lastUsedAt: row.lastUsedAt || null,
    })
  }
  return summary
}
