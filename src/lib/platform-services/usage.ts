import { prisma } from '@/lib/prisma'
import { logWarn } from '@/lib/logging/core'
import { getLogContext } from '@/lib/logging/context'
import { calcImage, calcText, calcVideoByTokens } from '@/lib/billing/cost'

type ServiceUsageRow = {
  provider: string
  modelKey: string | null
  serviceType: string
  operation: string
  status: string
  inputTokens: number
  outputTokens: number
  units: number | { toString(): string }
  latencyMs: number | null
  createdAt: Date
}

function calculateUsageCost(record: ServiceUsageRow): number {
  if (record.status === 'failed' || !record.modelKey) return 0
  try {
    if (record.serviceType === 'llm' || record.serviceType === 'video-repaint') {
      return calcText(record.modelKey, record.inputTokens, record.outputTokens)
    }
    if (record.serviceType === 'video' && record.outputTokens > 0) {
      return calcVideoByTokens(record.modelKey, record.outputTokens, {
        containsVideoInput: record.operation.endsWith(':video-input'),
      })
    }
    if (record.serviceType === 'image' && Number(record.units) > 0) {
      return calcImage(record.modelKey, Number(record.units))
    }
  } catch {
    // Custom/代理别名没有经过管理员定价时保持 0，避免伪造成本。
  }
  return 0
}

type ServiceUsageModel = {
  create(args: unknown): Promise<unknown>
  findMany(args: unknown): Promise<ServiceUsageRow[]>
}

const serviceUsageModel = (prisma as unknown as { serviceUsageRecord: ServiceUsageModel }).serviceUsageRecord

export interface ServiceUsageInput {
  provider: string
  modelKey?: string | null
  serviceType: 'llm' | 'image' | 'video' | 'audio' | 'storage' | 'video-repaint'
  operation: string
  status?: 'success' | 'failed'
  userId?: string | null
  projectId?: string | null
  inputTokens?: number
  outputTokens?: number
  units?: number
  latencyMs?: number | null
  errorCode?: string | null
}

function nonNegativeInteger(value: unknown): number {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : 0
}

function compact(value: unknown, max = 255): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

export async function recordServiceUsage(input: ServiceUsageInput): Promise<void> {
  try {
    const actorUserId = compact(getLogContext().userId, 191)
    await serviceUsageModel.create({
      data: {
        provider: compact(input.provider, 128) || 'unknown',
        modelKey: compact(input.modelKey) || null,
        serviceType: compact(input.serviceType, 32) || 'unknown',
        operation: compact(input.operation, 128) || 'unknown',
        status: input.status === 'failed' ? 'failed' : 'success',
        // API 鉴权会把 session.user.id 切换为工作区所有者；日志上下文保留真实登录账号。
        // 优先记录 actor，既能按子账号核算，也能继续按管理账号工作区汇总。
        userId: actorUserId || compact(input.userId, 191) || null,
        projectId: compact(input.projectId, 191) || null,
        inputTokens: nonNegativeInteger(input.inputTokens),
        outputTokens: nonNegativeInteger(input.outputTokens),
        units: Number.isFinite(Number(input.units)) ? Math.max(0, Number(input.units)) : 1,
        latencyMs: input.latencyMs == null ? null : nonNegativeInteger(input.latencyMs),
        errorCode: compact(input.errorCode, 128) || null,
      },
    })
  } catch (error) {
    logWarn('[ServiceUsage] 记录外部服务用量失败', {
      provider: input.provider,
      modelKey: input.modelKey,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

export function recordServiceUsageInBackground(input: ServiceUsageInput): void {
  if (process.env.NODE_ENV === 'test' && process.env.NORI_TEST_SERVICE_USAGE !== 'true') return
  const actorUserId = compact(getLogContext().userId, 191)
  void recordServiceUsage(actorUserId ? { ...input, userId: actorUserId } : input)
}

export async function getPlatformServiceUsageOverview(days = 30) {
  const normalizedDays = days === 7 || days === 90 ? days : 30
  const since = new Date(Date.now() - normalizedDays * 24 * 60 * 60 * 1_000)
  const [records, media] = await Promise.all([
    serviceUsageModel.findMany({
      where: { createdAt: { gte: since } },
      select: {
        provider: true,
        modelKey: true,
        serviceType: true,
        operation: true,
        status: true,
        inputTokens: true,
        outputTokens: true,
        units: true,
        latencyMs: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.mediaObject.aggregate({
      _count: { id: true },
      _sum: { sizeBytes: true },
    }),
  ])

  type UsageRow = {
    provider: string
    modelKey: string | null
    serviceType: string
    operation: string
    calls: number
    success: number
    failed: number
    inputTokens: number
    outputTokens: number
    units: number
    latencyTotal: number
    latencyCount: number
    lastUsedAt: Date
    cost: number
  }
  const grouped = new Map<string, UsageRow>()
  for (const record of records) {
    const key = `${record.provider}\u0000${record.modelKey || ''}\u0000${record.serviceType}\u0000${record.operation}`
    const row = grouped.get(key) || {
      provider: record.provider,
      modelKey: record.modelKey,
      serviceType: record.serviceType,
      operation: record.operation,
      calls: 0,
      success: 0,
      failed: 0,
      inputTokens: 0,
      outputTokens: 0,
      units: 0,
      latencyTotal: 0,
      latencyCount: 0,
      lastUsedAt: record.createdAt,
      cost: 0,
    }
    row.calls += 1
    if (record.status === 'failed') row.failed += 1
    else row.success += 1
    row.inputTokens += record.inputTokens
    row.outputTokens += record.outputTokens
    row.units += Number(record.units)
    row.cost += calculateUsageCost(record)
    if (typeof record.latencyMs === 'number') {
      row.latencyTotal += record.latencyMs
      row.latencyCount += 1
    }
    if (record.createdAt > row.lastUsedAt) row.lastUsedAt = record.createdAt
    grouped.set(key, row)
  }

  const rows = Array.from(grouped.values())
    .sort((left, right) => right.calls - left.calls || right.lastUsedAt.getTime() - left.lastUsedAt.getTime())
    .map((row) => ({
      provider: row.provider,
      modelKey: row.modelKey,
      serviceType: row.serviceType,
      operation: row.operation,
      calls: row.calls,
      success: row.success,
      failed: row.failed,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      units: row.units,
      averageLatencyMs: row.latencyCount ? Math.round(row.latencyTotal / row.latencyCount) : null,
      lastUsedAt: row.lastUsedAt.toISOString(),
      cost: Math.round(row.cost * 1_000_000) / 1_000_000,
    }))

  const totalLatency = records.reduce((sum, record) => sum + (record.latencyMs || 0), 0)
  const latencyCount = records.filter((record) => typeof record.latencyMs === 'number').length
  return {
    rangeDays: normalizedDays,
    collectedSince: since.toISOString(),
    summary: {
      calls: records.length,
      success: records.filter((record) => record.status !== 'failed').length,
      failed: records.filter((record) => record.status === 'failed').length,
      inputTokens: records.reduce((sum, record) => sum + record.inputTokens, 0),
      outputTokens: records.reduce((sum, record) => sum + record.outputTokens, 0),
      cost: Math.round(records.reduce((sum, record) => sum + calculateUsageCost(record), 0) * 1_000_000) / 1_000_000,
      averageLatencyMs: latencyCount ? Math.round(totalLatency / latencyCount) : null,
    },
    rows,
    storage: {
      objectCount: media._count.id,
      knownBytes: Number(media._sum.sizeBytes || 0),
    },
  }
}
