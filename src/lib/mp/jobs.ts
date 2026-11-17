import { createScopedLogger } from '@/lib/logging/core'
import { prisma } from '@/lib/prisma'
import { redis } from '@/lib/redis'
import { MP_EVENT_RETENTION_DAYS } from './constants'
import { bayesianRating, globalRatingAvg, hotScore, HOT_NEWNESS_DAYS } from './ranking'
import { goLive, type MpNotifyKind } from './release/lifecycle'
import { sendSubscribe } from './wx'

const logger = createScopedLogger({ module: 'mp-jobs' })

const NOTIFY_HINT: Record<MpNotifyKind, string> = {
  work_live: '你预约的作品已上线，快来开始游玩',
  chapter_update: '新章节已上线，快来继续你的故事',
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function templateOf(kind: MpNotifyKind): { id: string; fields: { title: string; hint: string; time: string } } | null {
  const id = (kind === 'work_live' ? process.env.MP_TPL_WORK_LIVE : process.env.MP_TPL_CHAPTER_UPDATE)?.trim()
  const raw = (kind === 'work_live' ? process.env.MP_TPL_WORK_LIVE_FIELDS : process.env.MP_TPL_CHAPTER_UPDATE_FIELDS)?.trim()
  if (!id || !raw) return null
  try {
    const fields = JSON.parse(raw) as Record<string, unknown>
    if (typeof fields.title !== 'string' || typeof fields.hint !== 'string' || typeof fields.time !== 'string') return null
    return { id, fields: { title: fields.title, hint: fields.hint, time: fields.time } }
  } catch {
    return null
  }
}

export function formatLiveTime(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

async function withJobLock(key: string, ttlSec: number, run: () => Promise<void>): Promise<void> {
  const locked = await redis.set(key, '1', 'EX', ttlSec, 'NX')
  if (locked !== 'OK') return
  try {
    await run()
  } finally {
    await redis.del(key).catch(() => undefined)
  }
}

export async function runScheduledGoLive(): Promise<void> {
  await withJobLock('mp:job:golive', 60, async () => {
    const due = await prisma.mpWork.findMany({
      where: { pendingReleaseId: { not: null }, scheduledAt: { lte: new Date() } },
      select: { id: true, pendingReleaseId: true },
      take: 20,
    })
    for (const work of due) {
      if (!work.pendingReleaseId) continue
      try {
        await goLive(work.pendingReleaseId)
        logger.info({ action: 'mp.golive.done', message: '定时上线完成', details: { mpWorkId: work.id } })
      } catch (error) {
        logger.warn({ action: 'mp.golive.failed', message: '定时上线失败', details: { mpWorkId: work.id, error: error instanceof Error ? error.message : String(error) } })
      }
    }
  })
}

interface NotifyItem { kind: MpNotifyKind; mpWorkId: string; releaseId: string }

async function processNotifyItem(item: NotifyItem): Promise<void> {
  const template = templateOf(item.kind)
  const work = await prisma.mpWork.findUnique({ where: { id: item.mpWorkId }, select: { id: true, slug: true, title: true } })
  if (!template || !work) {
    logger.warn({ action: 'mp.notify.skipped', message: '订阅消息模板未配置或作品不存在', details: { kind: item.kind, mpWorkId: item.mpWorkId } })
    return
  }
  const release = await prisma.storyRelease.findUnique({ where: { id: item.releaseId }, select: { liveAt: true } })
  const timeText = formatLiveTime(release?.liveAt ?? new Date())
  const title = [...work.title].slice(0, 20).join('')
  const page = `pages/work/index?w=${encodeURIComponent(work.slug)}&src=subscribe`
  let cursor: string | null = null
  for (;;) {
    const rows: { id: string; consumerId: string }[] = await prisma.mpSubscription.findMany({
      where: { mpWorkId: item.mpWorkId, kind: item.kind, credits: { gt: 0 }, OR: [{ lastSentRef: null }, { lastSentRef: { not: item.releaseId } }] },
      orderBy: { id: 'asc' },
      take: 200,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, consumerId: true },
    })
    if (!rows.length) break
    for (const row of rows) {
      const consumer = await prisma.consumerUser.findUnique({ where: { id: row.consumerId }, select: { openid: true } })
      if (consumer) {
        const result = await sendSubscribe(consumer.openid, template.id, page, {
          [template.fields.title]: { value: title },
          [template.fields.hint]: { value: NOTIFY_HINT[item.kind] },
          [template.fields.time]: { value: timeText },
        })
        if (result.errcode === 0 || result.errcode === 43101) {
          await prisma.mpSubscription.update({ where: { id: row.id }, data: { credits: { decrement: 1 }, lastSentRef: item.releaseId } })
        } else {
          logger.warn({ action: 'mp.notify.send_failed', message: '订阅消息发送失败', details: { subscriptionId: row.id, errcode: result.errcode } })
        }
      }
      await sleep(50)
    }
    cursor = rows[rows.length - 1].id
    if (rows.length < 200) break
  }
}

export async function sendNotifications(): Promise<void> {
  await withJobLock('mp:job:notify', 300, async () => {
    // 一次 tick 只处理一个队列项；处理完才 LPOP，中途崩溃靠 lastSentRef 防重复。
    const raw = await redis.lindex('mp:notify:queue', 0)
    if (!raw) return
    let item: NotifyItem
    try {
      const parsed = JSON.parse(raw) as Partial<NotifyItem>
      if ((parsed.kind !== 'work_live' && parsed.kind !== 'chapter_update') || typeof parsed.mpWorkId !== 'string' || typeof parsed.releaseId !== 'string') {
        await redis.lpop('mp:notify:queue')
        return
      }
      item = { kind: parsed.kind, mpWorkId: parsed.mpWorkId, releaseId: parsed.releaseId }
    } catch {
      await redis.lpop('mp:notify:queue')
      return
    }
    try {
      await processNotifyItem(item)
    } finally {
      await redis.lpop('mp:notify:queue')
    }
  })
}

const DAY_MS = 24 * 3600 * 1000
const BEIJING_OFFSET_MS = 8 * 3600 * 1000
const STATS_INTERVAL_MS = 10 * 60 * 1000
const AGG_BATCH_MAX = 50000
const EVENT_DELETE_BATCH = 5000

/** 北京日历日，用 UTC 零点的 DateTime 表示（与 MpWorkDailyStat.date 的存储口径一致）。 */
function beijingDate(at: Date): Date {
  const shifted = new Date(at.getTime() + BEIJING_OFFSET_MS)
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()))
}

function num(value: unknown): number {
  const n = Number(value ?? 0)
  return Number.isFinite(n) ? n : 0
}

async function dueEvery(name: string, intervalMs: number): Promise<boolean> {
  const key = `mp:job:${name}:next`
  const now = Date.now()
  try {
    const raw = await redis.get(key)
    if (raw && Number(raw) > now) return false
    await redis.set(key, String(now + intervalMs), 'EX', Math.ceil(intervalMs / 1000) + 60)
    return true
  } catch {
    // Redis 不可用时跳过本轮聚合，下个 tick 再试。
    return false
  }
}

export async function aggregateEvents(): Promise<void> {
  await withJobLock('mp:job:agg', 300, async () => {
    const state = await prisma.mpJobState.findUnique({ where: { key: 'agg.lastEventId' } })
    const watermark = state && /^\d+$/.test(state.value) ? BigInt(state.value) : BigInt(0)
    const rows = await prisma.mpEvent.findMany({
      where: { id: { gt: watermark } },
      orderBy: { id: 'asc' },
      take: AGG_BATCH_MAX,
      select: { id: true, name: true, mpWorkId: true, nodeId: true, optionId: true, flag: true, shareId: true },
    })
    if (!rows.length) return
    const branches = new Map<string, { mpWorkId: string; nodeId: string; optionId: string; count: number }>()
    const addBranch = (mpWorkId: string, nodeId: string, optionId: string) => {
      const key = JSON.stringify([mpWorkId, nodeId, optionId])
      const entry = branches.get(key)
      if (entry) entry.count += 1
      else branches.set(key, { mpWorkId, nodeId, optionId, count: 1 })
    }
    const shareOpens = new Map<string, number>()
    for (const row of rows) {
      if (row.name === 'choice_made' && row.mpWorkId && row.nodeId && row.optionId) {
        addBranch(row.mpWorkId, row.nodeId, row.optionId)
      } else if (row.name === 'ending_reached' && row.flag === true && row.mpWorkId && row.nodeId) {
        addBranch(row.mpWorkId, row.nodeId, '')
      } else if (row.name === 'app_launch' && row.shareId) {
        shareOpens.set(row.shareId, (shareOpens.get(row.shareId) ?? 0) + 1)
      }
    }
    const lastEventId = String(rows[rows.length - 1].id)
    // 累加与水位同事务：中途崩溃只会重算，不会丢计数。
    await prisma.$transaction(async (tx) => {
      for (const stat of branches.values()) {
        await tx.$executeRaw`
          INSERT INTO mp_branch_stats (id, mpWorkId, nodeId, optionId, count)
          VALUES (UUID(), ${stat.mpWorkId}, ${stat.nodeId}, ${stat.optionId}, ${stat.count})
          ON DUPLICATE KEY UPDATE count = count + VALUES(count)`
      }
      for (const [shareId, opens] of shareOpens) {
        await tx.$executeRaw`UPDATE mp_shares SET opens = opens + ${opens} WHERE id = ${shareId}`
      }
      await tx.mpJobState.upsert({
        where: { key: 'agg.lastEventId' },
        create: { key: 'agg.lastEventId', value: lastEventId },
        update: { value: lastEventId },
      })
    })
  })
}

interface DailyRow {
  views: number; starts: number; players: number; completions: number; shares: number
  shareOpens: number; newUsers: number; watchSec: number; favorites: number; reserves: number
}

export async function aggregateDaily(): Promise<void> {
  await withJobLock('mp:job:daily', 300, async () => {
    const today = beijingDate(new Date())
    for (const day of [new Date(today.getTime() - DAY_MS), today]) {
      const start = new Date(day.getTime() - BEIJING_OFFSET_MS)
      const end = new Date(start.getTime() + DAY_MS)
      const [eventRows, newUserRows, shareOpenRows] = await Promise.all([
        prisma.$queryRaw<Array<Record<string, unknown>>>`
          SELECT mpWorkId,
            SUM(name = 'work_view') AS views,
            SUM(name = 'play_start') AS starts,
            COUNT(DISTINCT CASE WHEN name = 'play_start' THEN COALESCE(consumerId, anonId) END) AS players,
            SUM(name = 'ending_reached') AS completions,
            SUM(name = 'share_click') AS shares,
            SUM(CASE WHEN name = 'play_exit' THEN COALESCE(value, 0) ELSE 0 END) AS watchSec,
            SUM(CASE WHEN name = 'favorite' THEN COALESCE(value, 0) ELSE 0 END) AS favorites,
            SUM(CASE WHEN name = 'reserve' THEN COALESCE(value, 0) ELSE 0 END) AS reserves
          FROM mp_events
          WHERE createdAt >= ${start} AND createdAt < ${end} AND mpWorkId IS NOT NULL
          GROUP BY mpWorkId`,
        prisma.$queryRaw<Array<{ mpWorkId: string; n: unknown }>>`
          SELECT firstMpWorkId AS mpWorkId, COUNT(*) AS n
          FROM consumer_users
          WHERE createdAt >= ${start} AND createdAt < ${end} AND firstMpWorkId IS NOT NULL
          GROUP BY firstMpWorkId`,
        prisma.$queryRaw<Array<{ mpWorkId: string; n: unknown }>>`
          SELECT s.mpWorkId AS mpWorkId, COUNT(*) AS n
          FROM mp_events e JOIN mp_shares s ON s.id = e.shareId
          WHERE e.name = 'app_launch' AND e.createdAt >= ${start} AND e.createdAt < ${end}
          GROUP BY s.mpWorkId`,
      ])
      const merged = new Map<string, DailyRow>()
      const rowOf = (mpWorkId: string): DailyRow => {
        let row = merged.get(mpWorkId)
        if (!row) {
          row = { views: 0, starts: 0, players: 0, completions: 0, shares: 0, shareOpens: 0, newUsers: 0, watchSec: 0, favorites: 0, reserves: 0 }
          merged.set(mpWorkId, row)
        }
        return row
      }
      for (const raw of eventRows) {
        const mpWorkId = String(raw.mpWorkId)
        const row = rowOf(mpWorkId)
        row.views = num(raw.views)
        row.starts = num(raw.starts)
        row.players = num(raw.players)
        row.completions = num(raw.completions)
        row.shares = num(raw.shares)
        row.watchSec = num(raw.watchSec)
        row.favorites = num(raw.favorites)
        row.reserves = num(raw.reserves)
      }
      for (const raw of newUserRows) rowOf(raw.mpWorkId).newUsers = num(raw.n)
      for (const raw of shareOpenRows) rowOf(raw.mpWorkId).shareOpens = num(raw.n)
      for (const [mpWorkId, data] of merged) {
        await prisma.mpWorkDailyStat.upsert({
          where: { mpWorkId_date: { mpWorkId, date: day } },
          create: { mpWorkId, date: day, ...data },
          update: data,
        })
      }
    }
  })
}

export async function refreshWorkCounters(): Promise<void> {
  await withJobLock('mp:job:counters', 300, async () => {
    const since = new Date(Date.now() - 7 * DAY_MS)
    const [works, saveGroups, eventRows] = await Promise.all([
      prisma.mpWork.findMany({ select: { id: true, firstLiveAt: true, ratingCount: true, ratingSum: true } }),
      prisma.consumerSave.groupBy({ by: ['mpWorkId'], _count: { _all: true } }),
      prisma.$queryRaw<Array<{ mpWorkId: string; players: unknown; completions: unknown; shares: unknown; favorites: unknown }>>`
        SELECT mpWorkId,
          COUNT(DISTINCT CASE WHEN name = 'play_start' THEN consumerId END) AS players,
          SUM(name = 'ending_reached') AS completions,
          SUM(name = 'share_click') AS shares,
          SUM(CASE WHEN name = 'favorite' THEN COALESCE(value, 0) ELSE 0 END) AS favorites
        FROM mp_events
        WHERE createdAt >= ${since} AND mpWorkId IS NOT NULL
        GROUP BY mpWorkId`,
    ])
    const globalAvg = globalRatingAvg(works)
    const saves = new Map(saveGroups.map((group) => [group.mpWorkId, group._count._all]))
    const events = new Map(eventRows.map((row) => [row.mpWorkId, row]))
    const now = Date.now()
    for (const work of works) {
      const row = events.get(work.id)
      const players7d = num(row?.players)
      const daysSinceLive = work.firstLiveAt ? Math.max(0, (now - work.firstLiveAt.getTime()) / DAY_MS) : HOT_NEWNESS_DAYS
      await prisma.mpWork.update({
        where: { id: work.id },
        data: {
          playerCount: saves.get(work.id) ?? 0,
          players7d,
          hotScore: hotScore(players7d, num(row?.completions), num(row?.shares), num(row?.favorites), daysSinceLive),
          ratingScore: bayesianRating(work.ratingCount, work.ratingSum, globalAvg),
        },
      })
    }
    await redis.incr('mp:cache:ver').catch(() => undefined)
  })
}

export async function dailyMaintenance(): Promise<void> {
  const shifted = new Date(Date.now() + BEIJING_OFFSET_MS)
  if (shifted.getUTCHours() !== 3 || shifted.getUTCMinutes() >= 10) return
  const dayKey = beijingDate(new Date()).toISOString().slice(0, 10)
  const locked = await redis.set(`mp:job:maint:${dayKey}`, '1', 'EX', 24 * 3600, 'NX')
  if (locked !== 'OK') return
  const [works, favoriteGroups, reserveGroups] = await Promise.all([
    prisma.mpWork.findMany({ select: { id: true, favoriteCount: true, reserveCount: true } }),
    prisma.consumerFavorite.groupBy({ by: ['mpWorkId'], _count: { _all: true } }),
    prisma.mpReservation.groupBy({ by: ['mpWorkId'], _count: { _all: true } }),
  ])
  const favorites = new Map(favoriteGroups.map((group) => [group.mpWorkId, group._count._all]))
  const reserves = new Map(reserveGroups.map((group) => [group.mpWorkId, group._count._all]))
  for (const work of works) {
    const favoriteCount = favorites.get(work.id) ?? 0
    const reserveCount = reserves.get(work.id) ?? 0
    if (favoriteCount !== work.favoriteCount || reserveCount !== work.reserveCount) {
      await prisma.mpWork.update({ where: { id: work.id }, data: { favoriteCount, reserveCount } })
    }
  }
  const cutoff = new Date(Date.now() - MP_EVENT_RETENTION_DAYS * DAY_MS)
  for (;;) {
    const deleted = await prisma.$executeRaw`DELETE FROM mp_events WHERE createdAt < ${cutoff} LIMIT ${EVENT_DELETE_BATCH}`
    if (deleted < EVENT_DELETE_BATCH) break
    await sleep(200)
  }
  await pruneDyEvents()
}

/** 抖音事件清理（N14）：每天删 90 天前的 dy_events，分批 5000 行，走 createdAt 索引。 */
export async function pruneDyEvents(): Promise<void> {
  const cutoff = new Date(Date.now() - MP_EVENT_RETENTION_DAYS * DAY_MS)
  for (;;) {
    const deleted = await prisma.$executeRaw`DELETE FROM dy_events WHERE createdAt < ${cutoff} LIMIT ${EVENT_DELETE_BATCH}`
    if (deleted < EVENT_DELETE_BATCH) break
    await sleep(200)
  }
}

export async function runMpJobs(): Promise<void> {
  if (process.env.MP_JOBS_ENABLED?.trim() !== '1') return
  try {
    await runScheduledGoLive()
  } catch (error) {
    logger.warn({ action: 'mp.jobs.golive_failed', message: '定时上线任务失败', details: { error: error instanceof Error ? error.message : String(error) } })
  }
  try {
    await sendNotifications()
  } catch (error) {
    logger.warn({ action: 'mp.jobs.notify_failed', message: '订阅消息任务失败', details: { error: error instanceof Error ? error.message : String(error) } })
  }
  if (await dueEvery('agg', STATS_INTERVAL_MS)) {
    try {
      await aggregateEvents()
    } catch (error) {
      logger.warn({ action: 'mp.jobs.agg_failed', message: '事件聚合任务失败', details: { error: error instanceof Error ? error.message : String(error) } })
    }
  }
  if (await dueEvery('daily', STATS_INTERVAL_MS)) {
    try {
      await aggregateDaily()
    } catch (error) {
      logger.warn({ action: 'mp.jobs.daily_failed', message: '日统计任务失败', details: { error: error instanceof Error ? error.message : String(error) } })
    }
  }
  if (await dueEvery('counters', STATS_INTERVAL_MS)) {
    try {
      await refreshWorkCounters()
    } catch (error) {
      logger.warn({ action: 'mp.jobs.counters_failed', message: '计数刷新任务失败', details: { error: error instanceof Error ? error.message : String(error) } })
    }
  }
  try {
    await dailyMaintenance()
  } catch (error) {
    logger.warn({ action: 'mp.jobs.maint_failed', message: '每日维护任务失败', details: { error: error instanceof Error ? error.message : String(error) } })
  }
}
