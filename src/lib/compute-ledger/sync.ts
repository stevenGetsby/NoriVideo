/**
 * 平台侧自动记账：UsageCost → LedgerDailyFact 快照。
 * 读取时懒同步（60 秒节流 + 互斥锁 + 回看两天），删除前强制刷新，回填脚本复用同一套块函数。
 * 快照只增不减（GREATEST）：UsageCost 只追加，任何「变小」只可能来自级联删除，必须忽略。
 * 内部记录（agent / 自动创作）用「全量 − 内部」两遍法精确排除，与费用页同口径。
 */
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { toMoneyNumber, type MoneyValue } from '@/lib/billing/money'
import { logInfo, logWarn } from '@/lib/logging/core'
import { ACTIVITY_OFFSET_MS, shanghaiDateKey } from '@/lib/account/activity-stats-shared'
import {
  isInternalUsageCostRecord,
  parseJsonRecord,
} from '@/lib/workspace/internal-record-visibility'
import { addDaysKey, fromMicros, normalizeProjectName, toMicros, todayKey } from './calc'

const CHUNK_DAYS = 31
const LOOKBACK_DAYS = 2
const SYNC_THROTTLE_MS = 60_000
const SYNC_REFRESH_THROTTLE_MS = 10_000
const SYNC_LOCK_MS = 60_000
const UPSERT_BATCH = 200
const DEFAULT_TOKEN_RATE = 46
const DEFAULT_JIMENG_RATE = 0.1

export type SyncResult = { complete: boolean; syncedThroughDate: string | null }

type FactRow = {
  workId: string
  workName: string
  dateKey: string
  actorId: string
  apiType: string
  costMicros: number
  callCount: number
}

type UpsertRow = {
  workspaceOwnerId: string
  ledgerProjectId: string
  dateKey: string
  actorUserId: string
  actorLabel: string
  apiType: string
  costMicros: number
  callCount: number
}

function dayStartUtc(dateKey: string): Date {
  const [y, m, d] = dateKey.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d) - ACTIVITY_OFFSET_MS)
}

function factKey(workId: string, dateKey: string, actorId: string, apiType: string): string {
  return `${workId}|${dateKey}|${actorId}|${apiType}`
}

function actorIdFromRow(userId: string, metadata: string | null): string {
  const quota = parseJsonRecord(metadata)?.quotaUserId
  return typeof quota === 'string' && quota && quota !== 'null' ? quota : userId
}

export async function getOrCreateSetting(ownerId: string) {
  return prisma.ledgerSetting.upsert({
    where: { workspaceOwnerId: ownerId },
    create: {
      workspaceOwnerId: ownerId,
      tokenRateCnyPerMillion: DEFAULT_TOKEN_RATE,
      jimengCnyPerPoint: DEFAULT_JIMENG_RATE,
    },
    update: {},
  })
}

/** 一块 [fromKey, toKey]（上海日，含两端）的两遍法汇总。projectId 用于删除前只快照单个作品。 */
export async function runFactChunk(
  ownerId: string,
  fromKey: string,
  toKey: string,
  projectId?: string,
): Promise<FactRow[]> {
  const fromUtc = dayStartUtc(fromKey)
  const toUtc = dayStartUtc(addDaysKey(toKey, 1))
  const projectFilter = projectId ? Prisma.sql`AND u.projectId = ${projectId}` : Prisma.empty

  const allRows = await prisma.$queryRaw<Array<{
    workId: string
    workName: string
    dateKey: string
    actorId: string
    apiType: string
    costCny: MoneyValue
    callCount: bigint | number
  }>>(Prisma.sql`
    SELECT w.id AS workId,
           MAX(w.name) AS workName,
           DATE_FORMAT(DATE_ADD(u.createdAt, INTERVAL 8 HOUR), '%Y-%m-%d') AS dateKey,
           COALESCE(
             NULLIF(CASE WHEN u.metadata IS NOT NULL AND JSON_VALID(u.metadata)
                         THEN JSON_UNQUOTE(JSON_EXTRACT(u.metadata, '$.quotaUserId')) END, 'null'),
             u.userId) AS actorId,
           u.apiType AS apiType,
           SUM(u.cost) AS costCny,
           COUNT(*) AS callCount
    FROM usage_costs u
    JOIN projects p ON p.id = u.projectId
    JOIN works w ON w.id = p.workId
    WHERE w.workspaceOwnerId = ${ownerId} AND u.createdAt >= ${fromUtc} AND u.createdAt < ${toUtc}
      ${projectFilter}
    GROUP BY w.id, dateKey, actorId, u.apiType
  `)

  const internalRows = await prisma.$queryRaw<Array<{
    id: string
    action: string | null
    apiType: string | null
    model: string | null
    metadata: string | null
    cost: MoneyValue
    createdAt: Date
    userId: string
    workId: string
  }>>(Prisma.sql`
    SELECT u.id, u.action, u.apiType, u.model, u.metadata, u.cost, u.createdAt, u.userId, w.id AS workId
    FROM usage_costs u
    JOIN projects p ON p.id = u.projectId
    JOIN works w ON w.id = p.workId
    WHERE w.workspaceOwnerId = ${ownerId} AND u.createdAt >= ${fromUtc} AND u.createdAt < ${toUtc}
      ${projectFilter}
      AND ( u.action LIKE '%agent%' OR u.model LIKE '%agent%' OR u.apiType LIKE '%agent%' OR u.metadata LIKE '%agent%'
         OR u.action LIKE '%自动创作模式%' OR u.model LIKE '%自动创作模式%' OR u.metadata LIKE '%自动创作模式%' )
  `)

  const internal = new Map<string, { micros: number; count: number }>()
  for (const row of internalRows) {
    if (!isInternalUsageCostRecord({ action: row.action, apiType: row.apiType, model: row.model, metadata: row.metadata })) continue
    const dateKey = shanghaiDateKey(row.createdAt)
    const actorId = actorIdFromRow(row.userId, row.metadata)
    const key = factKey(row.workId, dateKey, actorId, row.apiType ?? '')
    const entry = internal.get(key) ?? { micros: 0, count: 0 }
    entry.micros += toMicros(toMoneyNumber(row.cost))
    entry.count += 1
    internal.set(key, entry)
  }

  const facts: FactRow[] = []
  for (const row of allRows) {
    const key = factKey(row.workId, row.dateKey, row.actorId, row.apiType)
    const minus = internal.get(key) ?? { micros: 0, count: 0 }
    const costMicros = toMicros(toMoneyNumber(row.costCny)) - minus.micros
    if (costMicros <= 0) continue
    facts.push({
      workId: row.workId,
      workName: row.workName,
      dateKey: row.dateKey,
      actorId: row.actorId,
      apiType: row.apiType,
      costMicros,
      callCount: Math.max(0, Number(row.callCount) - minus.count),
    })
  }
  return facts
}

/** 项目关联：已关联跟随 Work 改名；否则认领同名外部项目；否则新建（撞唯一键重读）。 */
export async function ensureLedgerProjects(
  ownerId: string,
  works: Array<{ workId: string; workName: string }>,
): Promise<Map<string, string>> {
  const result = new Map<string, string>()
  for (const work of works) {
    const nameKey = normalizeProjectName(work.workName)
    const linked = await prisma.ledgerProject.findFirst({
      where: { workspaceOwnerId: ownerId, workId: work.workId },
    })
    if (linked) {
      if (linked.nameKey !== nameKey) {
        await prisma.ledgerProject.update({
          where: { id: linked.id },
          data: { name: work.workName, nameKey },
        })
      }
      result.set(work.workId, linked.id)
      continue
    }
    const candidates = await prisma.ledgerProject.findMany({
      where: { workspaceOwnerId: ownerId, workId: null, nameKey, archivedAt: null },
      orderBy: { createdAt: 'asc' },
    })
    if (candidates.length > 0) {
      const claimed = candidates[0]
      await prisma.ledgerProject.update({ where: { id: claimed.id }, data: { workId: work.workId } })
      if (candidates.length > 1) {
        logInfo('[Ledger] ambiguous name', { ownerId, nameKey, workId: work.workId, candidates: candidates.length })
      }
      result.set(work.workId, claimed.id)
      continue
    }
    try {
      const created = await prisma.ledgerProject.create({
        data: { workspaceOwnerId: ownerId, workId: work.workId, name: work.workName, nameKey },
      })
      result.set(work.workId, created.id)
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const reread = await prisma.ledgerProject.findFirst({
          where: { workspaceOwnerId: ownerId, workId: work.workId },
        })
        if (reread) result.set(work.workId, reread.id)
        continue
      }
      throw error
    }
  }
  return result
}

async function resolveActorLabels(ownerId: string, actorIds: string[]): Promise<Map<string, string>> {
  const labels = new Map<string, string>()
  if (actorIds.length === 0) return labels
  const users = await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } })
  for (const user of users) {
    if (user.name) labels.set(user.id, user.name.slice(0, 64))
  }
  const missing = actorIds.filter((id) => !labels.has(id))
  if (missing.length > 0) {
    const snapshots = await prisma.ledgerDailyFact.findMany({
      where: { workspaceOwnerId: ownerId, actorUserId: { in: missing } },
      select: { actorUserId: true, actorLabel: true },
      distinct: ['actorUserId'],
    })
    for (const snap of snapshots) {
      if (!labels.has(snap.actorUserId)) labels.set(snap.actorUserId, snap.actorLabel.slice(0, 64))
    }
  }
  for (const id of actorIds) {
    if (!labels.has(id)) labels.set(id, '未知账号')
  }
  return labels
}

/** 只增不减：GREATEST 挡住级联删除带来的「变小」。每批 ≤ 200 行。 */
export async function upsertFacts(rows: UpsertRow[]): Promise<void> {
  for (let i = 0; i < rows.length; i += UPSERT_BATCH) {
    const batch = rows.slice(i, i + UPSERT_BATCH)
    const values = batch.map((row) => Prisma.sql`(
      ${crypto.randomUUID()}, ${row.workspaceOwnerId}, ${row.ledgerProjectId}, ${row.dateKey},
      ${row.actorUserId}, ${row.actorLabel}, ${row.apiType}, ${(row.costMicros / 1_000_000).toFixed(6)},
      ${row.callCount}, NOW(3)
    )`)
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO ledger_daily_facts
        (id, workspaceOwnerId, ledgerProjectId, dateKey, actorUserId, actorLabel, apiType, costCny, callCount, syncedAt)
      VALUES ${Prisma.join(values)}
      ON DUPLICATE KEY UPDATE
        costCny = GREATEST(costCny, VALUES(costCny)),
        callCount = GREATEST(callCount, VALUES(callCount)),
        actorLabel = VALUES(actorLabel),
        syncedAt = NOW(3)
    `)
  }
}

export async function persistFactRows(ownerId: string, facts: FactRow[]): Promise<void> {
  if (facts.length === 0) return
  const works = new Map<string, string>()
  for (const fact of facts) works.set(fact.workId, fact.workName)
  const projectMap = await ensureLedgerProjects(ownerId, [...works.entries()].map(([workId, workName]) => ({ workId, workName })))
  const labels = await resolveActorLabels(ownerId, [...new Set(facts.map((fact) => fact.actorId))])
  const rows: UpsertRow[] = []
  for (const fact of facts) {
    const ledgerProjectId = projectMap.get(fact.workId)
    if (!ledgerProjectId) continue
    rows.push({
      workspaceOwnerId: ownerId,
      ledgerProjectId,
      dateKey: fact.dateKey,
      actorUserId: fact.actorId,
      actorLabel: labels.get(fact.actorId) ?? '未知账号',
      apiType: fact.apiType,
      costMicros: fact.costMicros,
      callCount: fact.callCount,
    })
  }
  await upsertFacts(rows)
}

async function earliestUsageCostKey(ownerId: string): Promise<string | null> {
  const rows = await prisma.$queryRaw<Array<{ minAt: Date | null }>>(Prisma.sql`
    SELECT MIN(u.createdAt) AS minAt
    FROM usage_costs u
    JOIN projects p ON p.id = u.projectId
    JOIN works w ON w.id = p.workId
    WHERE w.workspaceOwnerId = ${ownerId}
  `)
  const minAt = rows[0]?.minAt
  return minAt ? shanghaiDateKey(minAt) : null
}

/** 读取时懒同步。complete=false 时前端显示「正在补齐历史」并自动重取。 */
export async function syncPlatformFacts(
  ownerId: string,
  options: { maxChunks?: number; refresh?: boolean } = {},
): Promise<SyncResult> {
  const maxChunks = options.maxChunks ?? 3
  const setting = await getOrCreateSetting(ownerId)
  const now = new Date()
  const throttle = options.refresh ? SYNC_REFRESH_THROTTLE_MS : SYNC_THROTTLE_MS
  if (setting.lastSyncAt && now.getTime() - setting.lastSyncAt.getTime() < throttle) {
    return { complete: true, syncedThroughDate: setting.syncedThroughDate }
  }
  const locked = await prisma.ledgerSetting.updateMany({
    where: {
      workspaceOwnerId: ownerId,
      OR: [{ syncLockedUntil: null }, { syncLockedUntil: { lt: now } }],
    },
    data: { syncLockedUntil: new Date(now.getTime() + SYNC_LOCK_MS) },
  })
  if (locked.count === 0) {
    return { complete: true, syncedThroughDate: setting.syncedThroughDate }
  }

  const today = todayKey(now)
  let syncedThroughDate = setting.syncedThroughDate
  try {
    let startKey: string
    if (setting.syncedThroughDate) {
      startKey = addDaysKey(setting.syncedThroughDate, -LOOKBACK_DAYS)
    } else {
      const earliest = await earliestUsageCostKey(ownerId)
      if (!earliest) {
        syncedThroughDate = today
        return { complete: true, syncedThroughDate }
      }
      startKey = earliest
    }

    let cursor = startKey
    let processedEnd: string | null = null
    let complete = false
    for (let i = 0; i < maxChunks; i += 1) {
      if (cursor > today) {
        complete = true
        break
      }
      const shifted = addDaysKey(cursor, CHUNK_DAYS - 1)
      const chunkEnd = shifted < today ? shifted : today
      const facts = await runFactChunk(ownerId, cursor, chunkEnd)
      await persistFactRows(ownerId, facts)
      processedEnd = chunkEnd
      if (chunkEnd >= today) {
        complete = true
        break
      }
      cursor = addDaysKey(chunkEnd, 1)
    }
    syncedThroughDate = complete ? today : (processedEnd ?? setting.syncedThroughDate ?? today)
    return { complete, syncedThroughDate }
  } finally {
    await prisma.ledgerSetting.update({
      where: { workspaceOwnerId: ownerId },
      data: { lastSyncAt: new Date(), syncLockedUntil: null, syncedThroughDate },
    })
  }
}

/**
 * 回收站物理删除前强制快照该作品的整段历史。宁可晚删，不可丢账：
 * 抛错会让 purgeProject 失败并按既有重试逻辑重试；唯一例外是表尚未迁移（P2021）。
 */
export async function snapshotProjectCostsBeforePurge(projectId: string): Promise<void> {
  try {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { workId: true, work: { select: { workspaceOwnerId: true, name: true } } },
    })
    if (!project || !project.workId || !project.work) return
    const ownerId = project.work.workspaceOwnerId

    const bounds = await prisma.$queryRaw<Array<{ minAt: Date | null; maxAt: Date | null }>>(Prisma.sql`
      SELECT MIN(createdAt) AS minAt, MAX(createdAt) AS maxAt FROM usage_costs WHERE projectId = ${projectId}
    `)
    const minAt = bounds[0]?.minAt
    const maxAt = bounds[0]?.maxAt
    if (!minAt || !maxAt) return

    let cursor = shanghaiDateKey(minAt)
    const endKey = shanghaiDateKey(maxAt)
    while (cursor <= endKey) {
      const shifted = addDaysKey(cursor, CHUNK_DAYS - 1)
      const chunkEnd = shifted < endKey ? shifted : endKey
      const facts = await runFactChunk(ownerId, cursor, chunkEnd, projectId)
      await persistFactRows(ownerId, facts)
      cursor = addDaysKey(chunkEnd, 1)
    }
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2021') {
      logWarn('[Ledger] snapshot skipped: ledger tables not migrated yet', { projectId })
      return
    }
    throw error
  }
}