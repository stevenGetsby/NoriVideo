import { logInfo as _ulogInfo, logError as _ulogError } from '@/lib/logging/core'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import {
  isInternalBalanceTransactionRecord,
  isInternalUsageCostRecord,
} from '@/lib/workspace/internal-record-visibility'
import type { ApiType, UsageUnit } from './cost'
import { BillingOperationError } from './errors'
import { toMoneyNumber } from './money'

interface RecordParams {
  projectId: string
  userId: string
  action: string
  metadata?: Record<string, unknown>
}

interface PureRecordParams extends RecordParams {
  apiType: ApiType
  model: string
  quantity: number
  unit: UsageUnit
  cost: number
  balanceAfter: number
  freezeId?: string
  episodeId?: string | null
  taskType?: string | null
}

const VIRTUAL_PROJECT_IDS = new Set(['asset-hub', 'global-asset-hub', 'system'])
const DEFAULT_BILLING_PAGE = 1
const DEFAULT_BILLING_PAGE_SIZE = 20
const MAX_BILLING_PAGE_SIZE = 100

function isProjectScoped(projectId: string): boolean {
  return Boolean(projectId && !VIRTUAL_PROJECT_IDS.has(projectId))
}

export function normalizeBillingPagination(page: unknown, pageSize: unknown) {
  const parsedPage = typeof page === 'number' ? page : Number.parseInt(String(page ?? ''), 10)
  const parsedPageSize = typeof pageSize === 'number' ? pageSize : Number.parseInt(String(pageSize ?? ''), 10)
  const normalizedPage = Number.isFinite(parsedPage) && parsedPage > 0
    ? Math.floor(parsedPage)
    : DEFAULT_BILLING_PAGE
  const normalizedPageSize = Number.isFinite(parsedPageSize) && parsedPageSize > 0
    ? Math.min(MAX_BILLING_PAGE_SIZE, Math.floor(parsedPageSize))
    : DEFAULT_BILLING_PAGE_SIZE

  return {
    page: normalizedPage,
    pageSize: normalizedPageSize,
  }
}

/**
 * 从计费参数中提取展示用的详细信息，序列化为 JSON 存入 billingMeta
 * 前端按 unit 字段决定展示方式：
 *   image  → "3张 · 2K"
 *   video  → "5秒 · 720p"
 *   token  → "1500 tokens"
 *   second → "30秒"
 *   call   → "1次"
 */
export function buildBillingMeta(params: {
  quantity: number
  unit: string
  model: string
  apiType: string
  metadata?: Record<string, unknown>
}): string {
  // 尝试从 model composite ID 提取短名 "provider:xxx::model" → "model"
  const modelShort = params.model.includes('::')
    ? params.model.split('::').pop() ?? params.model
    : params.model

  const meta: Record<string, unknown> = {
    quantity: params.quantity,
    unit: params.unit,
    model: modelShort,
    apiType: params.apiType,
  }

  // 从 pricingSelections 提取 capability 字段（图片分辨率、视频时长/分辨率等）
  const selections = params.metadata?.pricingSelections
  if (selections && typeof selections === 'object') {
    const sel = selections as Record<string, unknown>
    if (sel.resolution) meta.resolution = sel.resolution
    if (sel.duration) meta.duration = sel.duration
    if (sel.generateAudio !== undefined) meta.generateAudio = sel.generateAudio
    if (sel.generationMode) meta.generationMode = sel.generationMode
  }

  // 文本计费的 token 信息
  if (params.metadata?.inputTokens) meta.inputTokens = params.metadata.inputTokens
  if (params.metadata?.outputTokens) meta.outputTokens = params.metadata.outputTokens

  // 实际使用的模型列表（复合模型场景）
  if (Array.isArray(params.metadata?.actualModels) && (params.metadata.actualModels as unknown[]).length > 0) {
    meta.actualModels = params.metadata.actualModels
  }

  return JSON.stringify(meta)
}

export async function recordUsageCostOnly(
  txOrPrisma: Prisma.TransactionClient | typeof prisma,
  params: PureRecordParams,
): Promise<void> {
  const hasProject = isProjectScoped(params.projectId)

  if (hasProject) {
    const project = await txOrPrisma.project.findUnique({
      where: { id: params.projectId },
      select: { id: true },
    })
    if (!project) {
      throw new BillingOperationError('BILLING_INVALID_PROJECT', `project not found for billing: ${params.projectId}`, {
        projectId: params.projectId,
        action: params.action,
        apiType: params.apiType,
      })
    }

    await txOrPrisma.usageCost.create({
      data: {
        projectId: params.projectId,
        userId: params.userId,
        apiType: params.apiType,
        model: params.model,
        action: params.action,
        quantity: params.quantity,
        unit: params.unit,
        cost: params.cost,
        metadata: params.metadata ? JSON.stringify(params.metadata) : null,
      },
    })
  } else {
    _ulogInfo(`[计费] 跳过 UsageCost 记录 (projectId=${params.projectId})，仅记录流水`)
  }

  await txOrPrisma.balanceTransaction.create({
    data: {
      userId: params.userId,
      type: 'consume',
      amount: -params.cost,
      balanceAfter: params.balanceAfter,
      description: `${params.action} - ${params.model}${hasProject ? '' : ' (Asset Hub)'}`,
      relatedId: params.freezeId || null,
      freezeId: params.freezeId || null,
      projectId: hasProject ? params.projectId : null,
      episodeId: params.episodeId || null,
      taskType: params.taskType || params.action || null,
      billingMeta: buildBillingMeta(params),
    },
  })

  _ulogInfo(`[计费] ${params.action} - ${params.model} - ¥${params.cost.toFixed(4)} (已记录${hasProject ? '' : '，无项目归属'})`)
}

export async function getProjectTotalCost(projectId: string): Promise<number> {
  try {
    const records = await prisma.usageCost.findMany({
      where: { projectId },
    })
    return records
      .filter((item) => !isInternalUsageCostRecord(item))
      .reduce((sum, item) => sum + toMoneyNumber(item.cost), 0)
  } catch (error) {
    _ulogError('[计费] 查询项目总费用失败:', error)
    return 0
  }
}

export async function getProjectCostDetails(projectId: string) {
  const recordsRaw = await prisma.usageCost.findMany({
    where: { projectId },
    orderBy: { createdAt: 'desc' },
  })

  const records = recordsRaw.filter((item) => !isInternalUsageCostRecord(item))
  const byTypeMap = new Map<string, { apiType: string; _sum: { cost: number }; _count: number }>()
  const byActionMap = new Map<string, { action: string; _sum: { cost: number }; _count: number }>()
  let total = 0

  for (const item of records) {
    const cost = toMoneyNumber(item.cost)
    total += cost
    const typeRow = byTypeMap.get(item.apiType) || { apiType: item.apiType, _sum: { cost: 0 }, _count: 0 }
    typeRow._sum.cost += cost
    typeRow._count += 1
    byTypeMap.set(item.apiType, typeRow)

    const actionRow = byActionMap.get(item.action) || { action: item.action, _sum: { cost: 0 }, _count: 0 }
    actionRow._sum.cost += cost
    actionRow._count += 1
    byActionMap.set(item.action, actionRow)
  }

  const recentRecords = records.slice(0, 50).map((item) => ({
    ...item,
    cost: toMoneyNumber(item.cost),
  }))

  return {
    total,
    byType: Array.from(byTypeMap.values()),
    byAction: Array.from(byActionMap.values()),
    recentRecords,
  }
}

export async function getUserCostSummary(userId: string) {
  try {
    const recordsRaw = await prisma.usageCost.findMany({
      where: { userId },
    })
    const records = recordsRaw.filter((item) => !isInternalUsageCostRecord(item))
    const byProjectMap = new Map<string, { projectId: string; _sum: { cost: number }; _count: number }>()
    let total = 0
    for (const item of records) {
      const cost = toMoneyNumber(item.cost)
      total += cost
      const row = byProjectMap.get(item.projectId) || { projectId: item.projectId, _sum: { cost: 0 }, _count: 0 }
      row._sum.cost += cost
      row._count += 1
      byProjectMap.set(item.projectId, row)
    }

    return {
      total,
      byProject: Array.from(byProjectMap.values()),
    }
  } catch (error) {
    _ulogError('[计费] 查询用户费用汇总失败:', error)
    return {
      total: 0,
      byProject: [],
    }
  }
}

export async function getVisibleUserTotalSpent(userId: string): Promise<number> {
  const records = await prisma.balanceTransaction.findMany({
    where: { userId, type: 'consume' },
    select: {
      amount: true,
      taskType: true,
      description: true,
      billingMeta: true,
    },
  })

  return records
    .filter((item) => !isInternalBalanceTransactionRecord(item))
    .reduce((sum, item) => sum + Math.abs(toMoneyNumber(item.amount)), 0)
}

export async function getUserCostDetails(userId: string, page = 1, pageSize = 20) {
  const pagination = normalizeBillingPagination(page, pageSize)
  const skip = (pagination.page - 1) * pagination.pageSize

  const recordsRaw = await prisma.usageCost.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  })
  const visibleRecords = recordsRaw.filter((item) => !isInternalUsageCostRecord(item))
  const total = visibleRecords.length

  const records = visibleRecords.slice(skip, skip + pagination.pageSize).map((item) => ({
    ...item,
    cost: toMoneyNumber(item.cost),
  }))

  return {
    records,
    total,
    page: pagination.page,
    pageSize: pagination.pageSize,
    totalPages: Math.ceil(total / pagination.pageSize),
  }
}
