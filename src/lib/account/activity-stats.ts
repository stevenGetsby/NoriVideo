import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { cnyToPoints } from '@/lib/billing/credit-policy'
import { toMoneyNumber } from '@/lib/billing/money'
import { isDirectSubaccountOf } from '@/lib/account/management'
import { isSubaccountRole, normalizeAccountRole } from '@/lib/account/permissions'
import {
  ALL_GENERATION_TASK_TYPES,
  ACTIVITY_TIME_ZONE,
  addMediaCount,
  emptyMediaCounts,
  mediaKindForMaterialType,
  mediaKindForTaskType,
  resolveActivityWindow,
  resolveTrendWindow,
  roundPoints,
  shanghaiDateKey,
  summarizeRows,
  MEDIA_KIND_LABELS,
  type ActivityDetail,
  type ActivityEvent,
  type ActivityOverview,
  type ActivityRange,
  type ActivityRecentTask,
  type ActivityRow,
  type ActivityTrendPoint,
  type ActivityWindow,
} from './activity-stats-shared'

/**
 * 工作监督统计（只读，不写库）。
 *
 * 子账号的产出在数据里挂在「钱包所有者」（管理员）名下，真实操作者只能从：
 *  - Task.payload.meta.quotaUserId（仅当操作者 != 钱包所有者时写入）
 *  - BalanceTransaction.billingMeta.quotaUserId
 *  - FrameosMaterial.ownerName（上传时写入操作者用户名）
 * 还原。历史上有独立钱包的子账号则直接以 Task.userId / BalanceTransaction.userId 归属。
 */

type Subject = {
  id: string
  name: string
  roleLabel: string | null
  status: 'active' | 'disabled'
  workspaceOwnerId: string | null
  lastLoginAt: Date | null
}

export async function listActivitySubjects(managerId: string): Promise<Subject[]> {
  const accounts = await prisma.user.findMany({
    where: { OR: [{ parentAccountId: managerId }, { workspaceOwnerId: managerId }] },
    select: {
      id: true,
      name: true,
      role: true,
      roleLabel: true,
      status: true,
      workspaceOwnerId: true,
      parentAccountId: true,
      lastLoginAt: true,
    },
  })
  return accounts
    .filter(
      (account) =>
        account.id !== managerId &&
        account.status !== 'deleted' &&
        isSubaccountRole(normalizeAccountRole(account.role)) &&
        isDirectSubaccountOf(account, managerId),
    )
    .map((account) => ({
      id: account.id,
      name: account.name,
      roleLabel: account.roleLabel,
      status: account.status === 'active' ? ('active' as const) : ('disabled' as const),
      workspaceOwnerId: account.workspaceOwnerId,
      lastLoginAt: account.lastLoginAt,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
}

function walletIds(managerId: string, subjects: readonly Subject[]): string[] {
  const ids = new Set<string>([managerId])
  for (const subject of subjects) {
    ids.add(subject.id)
    if (subject.workspaceOwnerId) ids.add(subject.workspaceOwnerId)
  }
  return [...ids]
}

const ACTOR_SQL = Prisma.sql`COALESCE(JSON_UNQUOTE(JSON_EXTRACT(t.payload, '$.meta.quotaUserId')), t.userId)`
const DONE_AT_SQL = Prisma.sql`COALESCE(t.finishedAt, t.updatedAt)`

function toNumber(value: unknown): number {
  if (value == null) return 0
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function toDate(value: unknown): Date | null {
  if (value == null) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  const text = String(value)
  const time = Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(text) ? text : `${text.replace(' ', 'T')}Z`)
  return Number.isFinite(time) ? new Date(time) : null
}

function laterOf(a: Date | null, b: Date | null): Date | null {
  if (!a) return b
  if (!b) return a
  return a.getTime() >= b.getTime() ? a : b
}

type TaskAggRow = {
  actorId: string | null
  type: string
  status: string
  n: unknown
  retried: unknown
  lastAt: unknown
}
type UploadAggRow = {
  ownerName: string | null
  type: string
  n: unknown
  uniqueN: unknown
  lastAt: unknown
}
type RetentionAggRow = { actorId: string | null; produced: unknown; kept: unknown }

function blankRow(subject: Subject): ActivityRow {
  return {
    userId: subject.id,
    name: subject.name,
    roleLabel: subject.roleLabel,
    status: subject.status,
    lastLoginAt: subject.lastLoginAt?.toISOString() ?? null,
    lastOutputAt: null,
    generated: emptyMediaCounts(),
    uploaded: emptyMediaCounts(),
    uploadedUnique: 0,
    failed: 0,
    retried: 0,
    points: 0,
    producedAssets: 0,
    keptAssets: 0,
  }
}

async function collectRows(
  managerId: string,
  subjects: readonly Subject[],
  window: ActivityWindow,
): Promise<ActivityRow[]> {
  const rows = new Map<string, ActivityRow>(subjects.map((subject) => [subject.id, blankRow(subject)]))
  if (subjects.length === 0) return []

  const wallets = walletIds(managerId, subjects)
  const subjectIds = subjects.map((subject) => subject.id)
  const idByName = new Map(subjects.map((subject) => [subject.name, subject.id]))
  const lastOutput = new Map<string, Date | null>()
  const noteOutput = (userId: string, at: Date | null) =>
    lastOutput.set(userId, laterOf(lastOutput.get(userId) ?? null, at))

  const [taskRows, uploadRows, retentionRows, ownCharges, attributedCharges] = await Promise.all([
    prisma.$queryRaw<TaskAggRow[]>(Prisma.sql`
      SELECT ${ACTOR_SQL} AS actorId, t.type AS type, t.status AS status,
             COUNT(*) AS n,
             SUM(CASE WHEN t.attempt > 1 THEN 1 ELSE 0 END) AS retried,
             MAX(${DONE_AT_SQL}) AS lastAt
      FROM tasks t
      WHERE t.userId IN (${Prisma.join(wallets)})
        AND t.status IN ('completed', 'failed')
        AND t.type IN (${Prisma.join(ALL_GENERATION_TASK_TYPES as string[])})
        AND ${DONE_AT_SQL} >= ${window.from} AND ${DONE_AT_SQL} < ${window.to}
        AND ${ACTOR_SQL} IN (${Prisma.join(subjectIds)})
      GROUP BY ${ACTOR_SQL}, t.type, t.status
    `),
    prisma.$queryRaw<UploadAggRow[]>(Prisma.sql`
      SELECT m.ownerName AS ownerName, m.type AS type, COUNT(*) AS n,
             COUNT(DISTINCT CASE
               WHEN JSON_EXTRACT(m.metadata, '$.originalName') IS NOT NULL
                AND JSON_EXTRACT(m.metadata, '$.sizeBytes') IS NOT NULL
               THEN CONCAT(JSON_UNQUOTE(JSON_EXTRACT(m.metadata, '$.originalName')), '|',
                           JSON_UNQUOTE(JSON_EXTRACT(m.metadata, '$.sizeBytes')))
               ELSE m.id END) AS uniqueN,
             MAX(m.createdAt) AS lastAt
      FROM frameos_materials m
      WHERE m.userId IN (${Prisma.join(wallets)})
        AND m.source = 'upload'
        AND JSON_EXTRACT(m.metadata, '$.inheritedFrom') IS NULL
        AND m.createdAt >= ${window.from} AND m.createdAt < ${window.to}
        AND m.ownerName IN (${Prisma.join(subjects.map((subject) => subject.name))})
      GROUP BY m.ownerName, m.type
    `),
    prisma.$queryRaw<RetentionAggRow[]>(Prisma.sql`
      SELECT ${ACTOR_SQL} AS actorId, COUNT(*) AS produced,
             SUM(CASE WHEN m.deletedAt IS NULL THEN 1 ELSE 0 END) AS kept
      FROM frameos_materials m
      JOIN tasks t ON t.id = JSON_UNQUOTE(JSON_EXTRACT(m.metadata, '$.taskId'))
      WHERE m.userId IN (${Prisma.join(wallets)})
        AND m.source <> 'upload'
        AND JSON_EXTRACT(m.metadata, '$.inheritedFrom') IS NULL
        AND m.createdAt >= ${window.from} AND m.createdAt < ${window.to}
        AND t.type IN (${Prisma.join(ALL_GENERATION_TASK_TYPES as string[])})
        AND ${ACTOR_SQL} IN (${Prisma.join(subjectIds)})
      GROUP BY ${ACTOR_SQL}
    `),
    prisma.balanceTransaction.groupBy({
      by: ['userId'],
      where: {
        userId: { in: subjectIds },
        type: 'consume',
        createdAt: { gte: window.from, lt: window.to },
      },
      _sum: { amount: true },
    }),
    prisma.balanceTransaction.findMany({
      where: {
        userId: { in: wallets },
        type: 'consume',
        createdAt: { gte: window.from, lt: window.to },
        billingMeta: { contains: '"quotaUserId":' },
      },
      select: { amount: true, billingMeta: true },
    }),
  ])

  for (const item of taskRows) {
    const row = item.actorId ? rows.get(item.actorId) : undefined
    if (!row) continue
    const n = toNumber(item.n)
    if (item.status === 'failed') {
      row.failed += n
    } else {
      const kind = mediaKindForTaskType(item.type)
      if (kind) addMediaCount(row.generated, kind, n)
    }
    row.retried += toNumber(item.retried)
    noteOutput(row.userId, toDate(item.lastAt))
  }

  for (const item of uploadRows) {
    const userId = item.ownerName ? idByName.get(item.ownerName) : undefined
    const row = userId ? rows.get(userId) : undefined
    const kind = mediaKindForMaterialType(item.type)
    if (!row || !kind) continue
    addMediaCount(row.uploaded, kind, toNumber(item.n))
    row.uploadedUnique += toNumber(item.uniqueN)
    noteOutput(row.userId, toDate(item.lastAt))
  }

  for (const item of retentionRows) {
    const row = item.actorId ? rows.get(item.actorId) : undefined
    if (!row) continue
    row.producedAssets += toNumber(item.produced)
    row.keptAssets += toNumber(item.kept)
  }

  const costByUser = new Map<string, number>()
  const addCost = (userId: string, amount: unknown) =>
    costByUser.set(
      userId,
      (costByUser.get(userId) ?? 0) + Math.abs(toMoneyNumber(amount as Parameters<typeof toMoneyNumber>[0])),
    )
  for (const item of ownCharges) addCost(item.userId, item._sum.amount)
  for (const item of attributedCharges) {
    try {
      const quotaUserId = JSON.parse(item.billingMeta || '{}').quotaUserId
      if (typeof quotaUserId === 'string' && rows.has(quotaUserId)) addCost(quotaUserId, item.amount)
    } catch {
      // 历史/损坏的元数据不能把消耗算到别人头上
    }
  }

  for (const row of rows.values()) {
    row.points = roundPoints(cnyToPoints(costByUser.get(row.userId) ?? 0))
    row.lastOutputAt = lastOutput.get(row.userId)?.toISOString() ?? null
  }
  return subjects.map((subject) => rows.get(subject.id)!)
}

export async function getActivityOverview(
  managerId: string,
  range: ActivityRange,
  now: Date = new Date(),
): Promise<ActivityOverview> {
  const window = resolveActivityWindow(range, now)
  const subjects = await listActivitySubjects(managerId)
  const rows = await collectRows(managerId, subjects, window)
  return {
    range,
    timeZone: ACTIVITY_TIME_ZONE,
    from: window.from.toISOString(),
    to: window.to.toISOString(),
    generatedAt: now.toISOString(),
    summary: summarizeRows(rows),
    rows,
  }
}

type BucketTaskRow = { dayKey: string; hourKey: unknown; type: string; status: string; n: unknown }
type BucketUploadRow = { dayKey: string; hourKey: unknown; n: unknown }
type EventTaskRow = {
  id: string
  type: string
  status: string
  attempt: unknown
  errorCode: string | null
  doneAt: unknown
}
type EventUploadRow = { title: string | null; type: string; createdAt: unknown }

const SHANGHAI_SHIFT = Prisma.sql`INTERVAL 8 HOUR`

export async function getActivityDetail(
  managerId: string,
  userId: string,
  range: ActivityRange,
  now: Date = new Date(),
): Promise<ActivityDetail | null> {
  const subjects = await listActivitySubjects(managerId)
  const subject = subjects.find((item) => item.id === userId)
  if (!subject) return null

  const window = resolveActivityWindow(range, now)
  const trend = resolveTrendWindow(now)
  const todayStart = resolveActivityWindow('today', now)
  const scanFrom = new Date(Math.min(window.from.getTime(), trend.from.getTime()))
  const scanTo = new Date(Math.max(window.to.getTime(), trend.to.getTime()))
  const wallets = walletIds(managerId, [subject])
  const taskTypes = ALL_GENERATION_TASK_TYPES as string[]

  const taskScope = Prisma.sql`
    t.userId IN (${Prisma.join(wallets)})
    AND t.status IN ('completed', 'failed')
    AND t.type IN (${Prisma.join(taskTypes)})
    AND ${ACTOR_SQL} = ${subject.id}`
  const uploadScope = Prisma.sql`
    m.userId IN (${Prisma.join(wallets)})
    AND m.source = 'upload'
    AND JSON_EXTRACT(m.metadata, '$.inheritedFrom') IS NULL
    AND m.ownerName = ${subject.name}`

  const [rows, bucketTasks, bucketUploads, todayTasks, todayUploads, recentTasks] = await Promise.all([
    collectRows(managerId, [subject], window),
    prisma.$queryRaw<BucketTaskRow[]>(Prisma.sql`
      SELECT DATE_FORMAT(DATE_ADD(${DONE_AT_SQL}, ${SHANGHAI_SHIFT}), '%Y-%m-%d') AS dayKey,
             HOUR(DATE_ADD(${DONE_AT_SQL}, ${SHANGHAI_SHIFT})) AS hourKey,
             t.type AS type, t.status AS status, COUNT(*) AS n
      FROM tasks t
      WHERE ${taskScope}
        AND ${DONE_AT_SQL} >= ${scanFrom} AND ${DONE_AT_SQL} < ${scanTo}
      GROUP BY dayKey, hourKey, t.type, t.status
    `),
    prisma.$queryRaw<BucketUploadRow[]>(Prisma.sql`
      SELECT DATE_FORMAT(DATE_ADD(m.createdAt, ${SHANGHAI_SHIFT}), '%Y-%m-%d') AS dayKey,
             HOUR(DATE_ADD(m.createdAt, ${SHANGHAI_SHIFT})) AS hourKey,
             COUNT(*) AS n
      FROM frameos_materials m
      WHERE ${uploadScope}
        AND m.createdAt >= ${scanFrom} AND m.createdAt < ${scanTo}
      GROUP BY dayKey, hourKey
    `),
    prisma.$queryRaw<EventTaskRow[]>(Prisma.sql`
      SELECT t.id AS id, t.type AS type, t.status AS status, t.attempt AS attempt,
             t.errorCode AS errorCode, ${DONE_AT_SQL} AS doneAt
      FROM tasks t
      WHERE ${taskScope}
        AND ${DONE_AT_SQL} >= ${todayStart.from} AND ${DONE_AT_SQL} < ${todayStart.to}
      ORDER BY doneAt DESC
      LIMIT 200
    `),
    prisma.$queryRaw<EventUploadRow[]>(Prisma.sql`
      SELECT m.title AS title, m.type AS type, m.createdAt AS createdAt
      FROM frameos_materials m
      WHERE ${uploadScope}
        AND m.createdAt >= ${todayStart.from} AND m.createdAt < ${todayStart.to}
      ORDER BY m.createdAt DESC
      LIMIT 200
    `),
    prisma.$queryRaw<EventTaskRow[]>(Prisma.sql`
      SELECT t.id AS id, t.type AS type, t.status AS status, t.attempt AS attempt,
             t.errorCode AS errorCode, ${DONE_AT_SQL} AS doneAt
      FROM tasks t
      WHERE ${taskScope}
        AND ${DONE_AT_SQL} >= ${window.from} AND ${DONE_AT_SQL} < ${window.to}
      ORDER BY doneAt DESC
      LIMIT 20
    `),
  ])

  const trendByDate = new Map<string, ActivityTrendPoint>(
    trend.dates.map((date) => [date, { date, generated: 0, video: 0, uploaded: 0, failed: 0 }]),
  )
  const windowDates = new Set<string>()
  for (let i = 0; i < window.days; i += 1) {
    windowDates.add(shanghaiDateKey(new Date(window.from.getTime() + i * 24 * 60 * 60 * 1000)))
  }
  const hours = Array.from({ length: 24 }, () => 0)
  const addHour = (dayKey: string, hourKey: unknown, n: number) => {
    const hour = Math.trunc(toNumber(hourKey))
    if (windowDates.has(dayKey) && hour >= 0 && hour < 24) hours[hour] += n
  }

  for (const item of bucketTasks) {
    const n = toNumber(item.n)
    const point = trendByDate.get(item.dayKey)
    if (item.status === 'failed') {
      if (point) point.failed += n
      continue
    }
    const kind = mediaKindForTaskType(item.type)
    if (point) {
      point.generated += n
      if (kind === 'video') point.video += n
    }
    addHour(item.dayKey, item.hourKey, n)
  }
  for (const item of bucketUploads) {
    const n = toNumber(item.n)
    const point = trendByDate.get(item.dayKey)
    if (point) point.uploaded += n
    addHour(item.dayKey, item.hourKey, n)
  }

  const toEvent = (item: EventTaskRow): ActivityEvent => {
    const media = mediaKindForTaskType(item.type)
    return {
      at: (toDate(item.doneAt) ?? now).toISOString(),
      kind: 'generate',
      media,
      status: item.status === 'failed' ? 'failed' : 'completed',
      title: media ? `生成${MEDIA_KIND_LABELS[media]}` : '生成',
    }
  }
  const timeline: ActivityEvent[] = [
    ...todayTasks.map(toEvent),
    ...todayUploads.map((item): ActivityEvent => ({
      at: (toDate(item.createdAt) ?? now).toISOString(),
      kind: 'upload',
      media: mediaKindForMaterialType(item.type),
      status: 'uploaded',
      title: item.title?.trim() || '未命名文件',
    })),
  ]
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, 200)

  const recent: ActivityRecentTask[] = recentTasks.map((item) => ({
    id: item.id,
    type: item.type,
    media: mediaKindForTaskType(item.type),
    status: item.status === 'failed' ? 'failed' : 'completed',
    attempt: toNumber(item.attempt),
    at: (toDate(item.doneAt) ?? now).toISOString(),
    errorCode: item.errorCode,
  }))

  return {
    range,
    timeZone: ACTIVITY_TIME_ZONE,
    from: window.from.toISOString(),
    to: window.to.toISOString(),
    generatedAt: now.toISOString(),
    row: rows[0],
    trend: trend.dates.map((date) => trendByDate.get(date)!),
    hours,
    timeline,
    recent,
  }
}
