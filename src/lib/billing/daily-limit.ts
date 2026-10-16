import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'
import { cnyToPoints } from './credit-policy'
import { DailyLimitExceededError } from './errors'
import { toMoneyNumber } from './money'
import { normalizeDailyPointLimit } from './daily-limit-policy'
import { getGenerationQuotaUserId } from '@/lib/account/request-context'
export { MAX_DAILY_POINT_LIMIT, normalizeDailyPointLimit, isValidDailyPointLimitInput } from './daily-limit-policy'

/**
 * 每日用量上限按「上海自然日」结算：00:00:00（UTC+8）到次日 00:00:00。
 * 中国大陆自 1991 年起不再使用夏令时，因此固定 8 小时偏移即可，
 * 也避免了把时区解析逻辑塞进每一次计费检查。
 */
export const DAILY_LIMIT_TIME_ZONE = 'Asia/Shanghai'
export const DAILY_LIMIT_OFFSET_MS = 8 * 60 * 60 * 1000

// 积分比较允许的浮点误差，避免 0.0001 级别的换算误差把刚好用满的用户误判为超限。
const POINTS_EPSILON = 1e-6
type DailyUsageClient = Pick<Prisma.TransactionClient, 'user' | 'balanceTransaction' | 'balanceFreeze'>

export type DailyUsageWindow = {
  timeZone: typeof DAILY_LIMIT_TIME_ZONE
  start: Date
  end: Date
}

export type DailyUsageSnapshot = {
  timeZone: typeof DAILY_LIMIT_TIME_ZONE
  windowStart: string
  windowEnd: string
  /** null 表示不限制 */
  limitPoints: number | null
  /** 今日已结算消耗的积分 */
  consumedPoints: number
  /** 今日已冻结、尚未结算的在途积分 */
  pendingPoints: number
  /** consumedPoints + pendingPoints */
  usedPoints: number
  /** 不限量时为 null */
  remainingPoints: number | null
  exceeded: boolean
}

export function resolveDailyUsageWindow(now: Date = new Date()): DailyUsageWindow {
  const shifted = now.getTime() + DAILY_LIMIT_OFFSET_MS
  const shiftedDate = new Date(shifted)
  const startOfShiftedDay = Date.UTC(
    shiftedDate.getUTCFullYear(),
    shiftedDate.getUTCMonth(),
    shiftedDate.getUTCDate(),
  )
  return {
    timeZone: DAILY_LIMIT_TIME_ZONE,
    start: new Date(startOfShiftedDay - DAILY_LIMIT_OFFSET_MS),
    end: new Date(startOfShiftedDay - DAILY_LIMIT_OFFSET_MS + 24 * 60 * 60 * 1000),
  }
}

export type DailyUsagePayload = {
  timeZone: string
  limitPoints: number | null
  usedPoints: number
  consumedPoints: number
  pendingPoints: number
  remainingPoints: number | null
  exceeded: boolean
  resetsAt: string
}

export function serializeDailyUsage(snapshot: DailyUsageSnapshot): DailyUsagePayload {
  return {
    timeZone: snapshot.timeZone,
    limitPoints: snapshot.limitPoints,
    usedPoints: snapshot.usedPoints,
    consumedPoints: snapshot.consumedPoints,
    pendingPoints: snapshot.pendingPoints,
    remainingPoints: snapshot.remainingPoints,
    exceeded: snapshot.exceeded,
    resetsAt: snapshot.windowEnd,
  }
}

function normalizePoints(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.round(Math.max(0, value) * 10_000) / 10_000
}

export async function getDailyUsageSnapshot(
  userId: string,
  now: Date = new Date(),
  client: DailyUsageClient = prisma,
): Promise<DailyUsageSnapshot> {
  const snapshots = await getDailyUsageSnapshotMap([userId], now, client)
  return snapshots.get(userId) || buildDailyUsageSnapshot(null, 0, 0, now)
}

function buildDailyUsageSnapshot(
  rawLimit: unknown,
  consumedCny: number,
  pendingCny: number,
  now: Date,
): DailyUsageSnapshot {
  const window = resolveDailyUsageWindow(now)
  const limitPoints = normalizeDailyPointLimit(rawLimit ?? null)
  // consume 流水以负数入账，取绝对值即为当日实际消耗。
  const consumedPoints = normalizePoints(cnyToPoints(Math.abs(consumedCny)))
  const pendingPoints = normalizePoints(cnyToPoints(Math.abs(pendingCny)))
  const usedPoints = normalizePoints(consumedPoints + pendingPoints)
  const remainingPoints = limitPoints === null
    ? null
    : normalizePoints(Math.max(0, limitPoints - usedPoints))

  return {
    timeZone: DAILY_LIMIT_TIME_ZONE,
    windowStart: window.start.toISOString(),
    windowEnd: window.end.toISOString(),
    limitPoints,
    consumedPoints,
    pendingPoints,
    usedPoints,
    remainingPoints,
    // 刚好用满也视为已用尽：此时任何新增生成都不可能再通过冻结校验。
    exceeded: limitPoints !== null && usedPoints + POINTS_EPSILON >= limitPoints,
  }
}

/**
 * 批量版本，供管理端一次渲染整个账号列表时使用。
 */
export async function getDailyUsageSnapshotMap(
  userIds: readonly string[],
  now: Date = new Date(),
  client: DailyUsageClient = prisma,
): Promise<Map<string, DailyUsageSnapshot>> {
  const uniqueIds = Array.from(new Set(userIds.filter((id) => typeof id === 'string' && id.trim())))
  const result = new Map<string, DailyUsageSnapshot>()
  if (uniqueIds.length === 0) return result

  const window = resolveDailyUsageWindow(now)
  const [accounts, consumedRows, pendingRows] = await Promise.all([
    client.user.findMany({
      where: { id: { in: uniqueIds } },
      select: { id: true, dailyPointLimit: true, workspaceOwnerId: true, role: true },
    }),
    client.balanceTransaction.groupBy({
      by: ['userId'],
      where: {
        userId: { in: uniqueIds },
        type: 'consume',
        createdAt: { gte: window.start, lt: window.end },
      },
      _sum: { amount: true },
    }),
    client.balanceFreeze.groupBy({
      by: ['userId'],
      where: {
        userId: { in: uniqueIds },
        status: 'pending',
        createdAt: { gte: window.start, lt: window.end },
      },
      _sum: { amount: true },
    }),
  ])

  const limitByUser = new Map(accounts.map((account) => [account.id, account.dailyPointLimit]))
  const consumedByUser = new Map(
    consumedRows.map((row) => [row.userId, Math.abs(toMoneyNumber(row._sum.amount ?? 0))]),
  )
  const pendingByUser = new Map(
    pendingRows.map((row) => [row.userId, Math.abs(toMoneyNumber(row._sum.amount ?? 0))]),
  )
  // Shared workspace tasks retain their historical wallet ownership, while
  // quota attribution follows the authenticated operator. Never change which
  // account is debited as part of a quota/UI update.
  const childOwners = new Map(accounts.flatMap((account) => account.workspaceOwnerId && account.workspaceOwnerId !== account.id
    ? [[account.id, account.workspaceOwnerId] as const] : []))
  const quotaWallets = Array.from(new Set([
    ...childOwners.values(),
    ...accounts.filter((account) => account.role === 'admin').map((account) => account.id),
  ]))
  if (quotaWallets.length > 0) {
    const owners = quotaWallets
    const [attributedCharges, attributedFreezes] = await Promise.all([
      client.balanceTransaction.findMany({
        where: { userId: { in: owners }, type: 'consume', createdAt: { gte: window.start, lt: window.end }, billingMeta: { contains: '"quotaUserId":' } },
        select: { userId: true, amount: true, billingMeta: true },
      }),
      client.balanceFreeze.findMany({
        where: { userId: { in: owners }, status: 'pending', createdAt: { gte: window.start, lt: window.end }, metadata: { contains: '"quotaUserId":' } },
        select: { userId: true, amount: true, metadata: true },
      }),
    ])
    const addAttributed = (rows: Array<{ userId: string; amount: unknown; metadata?: string | null; billingMeta?: string | null }>, totals: Map<string, number>) => {
      for (const row of rows) {
        try {
          const quotaUserId = JSON.parse(row.billingMeta || row.metadata || '{}').quotaUserId
          // The manager's own quota is not consumed by an attributed child
          // operation, even though the shared wallet retains that debit.
          if (typeof quotaUserId === 'string' && quotaUserId !== row.userId && uniqueIds.includes(row.userId)) {
            totals.set(row.userId, Math.max(0, (totals.get(row.userId) || 0) - Math.abs(toMoneyNumber(row.amount as Parameters<typeof toMoneyNumber>[0]))))
          }
          if (typeof quotaUserId === 'string' && childOwners.get(quotaUserId) === row.userId) {
            totals.set(quotaUserId, (totals.get(quotaUserId) || 0) + Math.abs(toMoneyNumber(row.amount as Parameters<typeof toMoneyNumber>[0])))
          }
        } catch { /* Legacy/malformed metadata must not attribute another user's spend. */ }
      }
    }
    addAttributed(attributedCharges, consumedByUser)
    addAttributed(attributedFreezes, pendingByUser)
  }

  for (const userId of uniqueIds) {
    result.set(
      userId,
      buildDailyUsageSnapshot(
        limitByUser.get(userId) ?? null,
        consumedByUser.get(userId) ?? 0,
        pendingByUser.get(userId) ?? 0,
        now,
      ),
    )
  }
  return result
}

/**
 * 生成任务与同步计费的统一闸门。`additionalCostCny` 传入本次请求的报价时，
 * 会连同今日已用（含在途冻结）一起判断，避免并发提交一次性冲过上限。
 */
export async function assertDailyLimit(
  userId: string,
  options?: { additionalCostCny?: number; now?: Date },
  client: DailyUsageClient = prisma,
): Promise<DailyUsageSnapshot> {
  const snapshot = await getDailyUsageSnapshot(getGenerationQuotaUserId(userId), options?.now, client)
  return assertSnapshotLimit(snapshot, options)
}

function assertSnapshotLimit(snapshot: DailyUsageSnapshot, options?: { additionalCostCny?: number }): DailyUsageSnapshot {
  if (snapshot.limitPoints === null) return snapshot

  const requestedCny = options?.additionalCostCny
  const requestedPoints = typeof requestedCny === 'number' && Number.isFinite(requestedCny) && requestedCny > 0
    ? normalizePoints(cnyToPoints(requestedCny))
    : 0
  const projectedPoints = normalizePoints(snapshot.usedPoints + requestedPoints)

  const requestOvershoots = requestedPoints > 0
    ? projectedPoints - snapshot.limitPoints > POINTS_EPSILON
    : snapshot.usedPoints + POINTS_EPSILON >= snapshot.limitPoints
  if (snapshot.limitPoints === 0 || requestOvershoots) {
    throw new DailyLimitExceededError({
      limitPoints: snapshot.limitPoints,
      usedPoints: snapshot.usedPoints,
      requestedPoints,
      windowEnd: snapshot.windowEnd,
    })
  }

  return snapshot
}
