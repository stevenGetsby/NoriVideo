import { ApiError } from '@/lib/api-errors'
import type { StoryProgram } from '@/lib/interactive/types'
import { prisma } from '@/lib/prisma'
import { redis } from '@/lib/redis'
import { MP_BRANCH_MIN_SAMPLES, MP_ENDING_MIN_SAMPLES } from './constants'
import { MpApiError } from './errors'

const DAY_MS = 24 * 3600 * 1000
const BEIJING_OFFSET_MS = 8 * 3600 * 1000
const RELEASE_CACHE_SEC = 600
const CREATOR_CACHE_SEC = 600
const ADMIN_CACHE_SEC = 300

export interface ReleaseStats {
  choices: Record<string, Record<string, number>>
  endings: Record<string, number>
}

export interface CreatorStats {
  kpis: { views: number; starts: number; players: number; completionRate: number; avgWatchMin: number; shares: number; newUsers: number }
  daily: { date: string; players: number; starts: number; completions: number }[]
  endings: { nodeId: string; title: string; endingType: string; count: number; pct: number }[]
  choices: { nodeId: string; title: string; options: { optionId: string; label: string; count: number; pct: number }[] }[]
  dropoffs: { nodeId: string; title: string; exits: number }[]
  channels: { code: string; name: string; newUsers: number; players: number }[]
}

export interface AdminStats {
  kpis: { newUsers: number; activeUsers: number; starts: number; completions: number; shares: number; shareNewUsers: number }
  daily: { date: string; newUsers: number; starts: number }[]
  works: { title: string; players: number; completionRate: number; shares: number; ratingScore: number; ratingCount: number }[]
  sources: { source: string; newUsers: number }[]
  channels: { name: string; target: string; newUsers: number; players: number }[]
}

async function withCache<T>(key: string, ttlSec: number, loader: () => Promise<T>): Promise<T> {
  const hit = await redis.get(key).catch(() => null)
  if (hit) {
    try { return JSON.parse(hit) as T } catch { /* 坏缓存当作未命中 */ }
  }
  const value = await loader()
  await redis.set(key, JSON.stringify(value), 'EX', ttlSec).catch(() => undefined)
  return value
}

function pct1(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0
}

/** 北京日历日，用 UTC 零点的 DateTime 表示（date 列只存日期部分）。 */
function beijingDay(at: Date): Date {
  const shifted = new Date(at.getTime() + BEIJING_OFFSET_MS)
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()))
}

function dayKey(day: Date): string {
  return day.toISOString().slice(0, 10)
}

function rangeDays(range: string | null): number {
  return range === '30d' ? 30 : 7
}

function rawDay(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value).slice(0, 10)
}

// ---------- C 端社交证明（E.3 / H.7） ----------

export async function releaseStats(releaseId: string): Promise<ReleaseStats> {
  const work = await prisma.mpWork.findFirst({
    where: { OR: [{ liveReleaseId: releaseId }, { pendingReleaseId: releaseId }], status: { in: ['live', 'scheduled'] }, work: { deletedAt: null } },
    select: { id: true, playerCount: true },
  })
  if (!work) throw new MpApiError('MP_WORK_NOT_FOUND')
  return withCache(`mp:stats:release:${releaseId}`, RELEASE_CACHE_SEC, async () => {
    const rows = await prisma.mpBranchStat.findMany({ where: { mpWorkId: work.id } })
    const choices: Record<string, Record<string, number>> = {}
    const totals = new Map<string, number>()
    for (const row of rows) {
      if (!row.optionId) continue
      totals.set(row.nodeId, (totals.get(row.nodeId) ?? 0) + row.count)
    }
    for (const row of rows) {
      if (!row.optionId) continue
      const total = totals.get(row.nodeId) ?? 0
      if (total < MP_BRANCH_MIN_SAMPLES) continue
      choices[row.nodeId] = choices[row.nodeId] ?? {}
      choices[row.nodeId][row.optionId] = pct1(row.count, total)
    }
    const endings: Record<string, number> = {}
    for (const row of rows) {
      if (row.optionId || row.count < MP_ENDING_MIN_SAMPLES) continue
      endings[row.nodeId] = pct1(row.count, work.playerCount)
    }
    return { choices, endings }
  })
}

// ---------- 创作者数据（H.9） ----------

interface NodeInfo { title: string; endingType?: string; options?: Map<string, string> }

function programNodes(program: unknown): Map<string, NodeInfo> {
  const nodes = new Map<string, NodeInfo>()
  const typed = program as StoryProgram | null
  if (!typed || !Array.isArray(typed.chapters)) return nodes
  for (const chapter of typed.chapters) {
    if (!Array.isArray(chapter?.nodes)) continue
    for (const node of chapter.nodes) {
      if (!node || typeof node.id !== 'string') continue
      if (node.kind === 'choice') {
        nodes.set(node.id, { title: node.title, options: new Map((node.options ?? []).map((option) => [option.id, option.label])) })
      } else if (node.kind === 'ending') {
        nodes.set(node.id, { title: node.title, endingType: node.endingType })
      } else {
        nodes.set(node.id, { title: node.title })
      }
    }
  }
  return nodes
}

export async function creatorStats(workId: string, range: string | null): Promise<CreatorStats> {
  const work = await prisma.mpWork.findUnique({ where: { workId }, select: { id: true, playerCount: true, liveReleaseId: true } })
  if (!work) throw new ApiError('NOT_FOUND', { message: '作品不存在。' })
  const days = rangeDays(range)
  return withCache(`mp:cache:stats:${work.id}:${days}d`, CREATOR_CACHE_SEC, async () => {
    const since = new Date(Date.now() - days * DAY_MS)
    const today = beijingDay(new Date())
    const axisStart = new Date(today.getTime() - (days - 1) * DAY_MS)
    const [dailyRows, playersRaw, release, branchRows, dropoffGroups, channelRows] = await Promise.all([
      prisma.mpWorkDailyStat.findMany({ where: { mpWorkId: work.id, date: { gte: axisStart } }, orderBy: { date: 'asc' } }),
      prisma.$queryRaw<Array<{ players: bigint }>>`
        SELECT COUNT(DISTINCT COALESCE(consumerId, anonId)) AS players
        FROM mp_events WHERE mpWorkId = ${work.id} AND name = 'play_start' AND createdAt >= ${since}`,
      work.liveReleaseId
        ? prisma.storyRelease.findUnique({ where: { id: work.liveReleaseId }, select: { program: true } })
        : Promise.resolve(null),
      prisma.mpBranchStat.findMany({ where: { mpWorkId: work.id } }),
      prisma.mpEvent.groupBy({
        by: ['nodeId'],
        where: { mpWorkId: work.id, name: 'play_exit', flag: false, nodeId: { not: null }, createdAt: { gte: since } },
        _count: { _all: true },
        orderBy: { _count: { nodeId: 'desc' } },
        take: 10,
      }),
      prisma.mpChannel.findMany({ where: { mpWorkId: work.id, archived: false }, orderBy: { createdAt: 'desc' } }),
    ])
    const players = Number(playersRaw[0]?.players ?? 0)
    const sums = dailyRows.reduce((acc, row) => ({
      views: acc.views + row.views,
      starts: acc.starts + row.starts,
      completions: acc.completions + row.completions,
      shares: acc.shares + row.shares,
      newUsers: acc.newUsers + row.newUsers,
      watchSec: acc.watchSec + row.watchSec,
    }), { views: 0, starts: 0, completions: 0, shares: 0, newUsers: 0, watchSec: 0 })
    const byDay = new Map(dailyRows.map((row) => [dayKey(row.date), row]))
    const daily: CreatorStats['daily'] = []
    for (let i = 0; i < days; i += 1) {
      const day = new Date(axisStart.getTime() + i * DAY_MS)
      const row = byDay.get(dayKey(day))
      daily.push({ date: dayKey(day), players: row?.players ?? 0, starts: row?.starts ?? 0, completions: row?.completions ?? 0 })
    }
    const nodes = programNodes(release?.program)
    const endings: CreatorStats['endings'] = branchRows
      .filter((row) => !row.optionId)
      .sort((a, b) => b.count - a.count)
      .map((row) => ({
        nodeId: row.nodeId,
        title: nodes.get(row.nodeId)?.title ?? '',
        endingType: nodes.get(row.nodeId)?.endingType ?? 'normal',
        count: row.count,
        pct: pct1(row.count, work.playerCount),
      }))
    const choiceTotals = new Map<string, number>()
    for (const row of branchRows) {
      if (row.optionId) choiceTotals.set(row.nodeId, (choiceTotals.get(row.nodeId) ?? 0) + row.count)
    }
    const choices: CreatorStats['choices'] = [...choiceTotals.entries()].map(([nodeId, total]) => ({
      nodeId,
      title: nodes.get(nodeId)?.title ?? '',
      options: branchRows
        .filter((row) => row.nodeId === nodeId && row.optionId)
        .sort((a, b) => b.count - a.count)
        .map((row) => ({
          optionId: row.optionId,
          label: nodes.get(nodeId)?.options?.get(row.optionId) ?? '',
          count: row.count,
          pct: pct1(row.count, total),
        })),
    }))
    const dropoffs: CreatorStats['dropoffs'] = dropoffGroups.flatMap((group) => group.nodeId
      ? [{ nodeId: group.nodeId, title: nodes.get(group.nodeId)?.title ?? '', exits: group._count._all }]
      : [])
    const channelIds = channelRows.map((row) => row.id)
    const [newUserGroups, playEvents] = channelIds.length
      ? await Promise.all([
        prisma.consumerUser.groupBy({ by: ['firstChannelId'], where: { firstChannelId: { in: channelIds }, createdAt: { gte: since } }, _count: { _all: true } }),
        prisma.mpEvent.findMany({
          where: { channelId: { in: channelIds }, name: 'play_start', createdAt: { gte: since }, consumerId: { not: null } },
          distinct: ['consumerId', 'channelId'],
          select: { consumerId: true, channelId: true },
        }),
      ])
      : [[], []]
    const newUsers = new Map<string, number>()
    for (const group of newUserGroups) {
      if (group.firstChannelId) newUsers.set(group.firstChannelId, group._count._all)
    }
    const channelPlayers = new Map<string, number>()
    for (const event of playEvents) {
      if (event.channelId) channelPlayers.set(event.channelId, (channelPlayers.get(event.channelId) ?? 0) + 1)
    }
    return {
      kpis: {
        views: sums.views,
        starts: sums.starts,
        players,
        completionRate: sums.starts > 0 ? Math.round((sums.completions / sums.starts) * 1000) / 1000 : 0,
        avgWatchMin: players > 0 ? Math.round((sums.watchSec / players / 60) * 10) / 10 : 0,
        shares: sums.shares,
        newUsers: sums.newUsers,
      },
      daily,
      endings,
      choices,
      dropoffs,
      channels: channelRows.map((row) => ({
        code: row.code,
        name: row.name,
        newUsers: newUsers.get(row.id) ?? 0,
        players: channelPlayers.get(row.id) ?? 0,
      })),
    }
  })
}

// ---------- 平台数据（D.5） ----------

export async function adminStats(range: string | null): Promise<AdminStats> {
  const days = rangeDays(range)
  return withCache(`mp:stats:admin:${days}d`, ADMIN_CACHE_SEC, async () => {
    const since = new Date(Date.now() - days * DAY_MS)
    const today = beijingDay(new Date())
    const axisStart = new Date(today.getTime() - (days - 1) * DAY_MS)
    const [newUsers, activeRaw, starts, completions, shares, shareNewUsers, userDays, startDays, workRaw, sourceGroups, channelRows] = await Promise.all([
      prisma.consumerUser.count({ where: { createdAt: { gte: since } } }),
      prisma.$queryRaw<Array<{ n: bigint }>>`
        SELECT COUNT(DISTINCT consumerId) AS n FROM mp_events WHERE consumerId IS NOT NULL AND createdAt >= ${since}`,
      prisma.mpEvent.count({ where: { name: 'play_start', createdAt: { gte: since } } }),
      prisma.mpEvent.count({ where: { name: 'ending_reached', createdAt: { gte: since } } }),
      prisma.mpEvent.count({ where: { name: 'share_click', createdAt: { gte: since } } }),
      prisma.consumerUser.count({ where: { firstShareId: { not: null }, createdAt: { gte: since } } }),
      prisma.$queryRaw<Array<{ day: Date | string; n: bigint }>>`
        SELECT DATE(createdAt + INTERVAL 8 HOUR) AS day, COUNT(*) AS n
        FROM consumer_users WHERE createdAt >= ${since} GROUP BY day`,
      prisma.$queryRaw<Array<{ day: Date | string; n: bigint }>>`
        SELECT DATE(createdAt + INTERVAL 8 HOUR) AS day, COUNT(*) AS n
        FROM mp_events WHERE name = 'play_start' AND createdAt >= ${since} GROUP BY day`,
      prisma.$queryRaw<Array<{ mpWorkId: string; players: bigint; starts: bigint; completions: bigint; shares: bigint }>>`
        SELECT mpWorkId,
          COUNT(DISTINCT CASE WHEN name = 'play_start' THEN COALESCE(consumerId, anonId) END) AS players,
          SUM(name = 'play_start') AS starts,
          SUM(name = 'ending_reached') AS completions,
          SUM(name = 'share_click') AS shares
        FROM mp_events
        WHERE mpWorkId IS NOT NULL AND createdAt >= ${since}
        GROUP BY mpWorkId ORDER BY players DESC LIMIT 20`,
      prisma.consumerUser.groupBy({ by: ['firstSource'], where: { createdAt: { gte: since } }, _count: { _all: true } }),
      prisma.mpChannel.findMany({ where: { archived: false }, orderBy: { createdAt: 'desc' } }),
    ])
    const userByDay = new Map(userDays.map((row) => [rawDay(row.day), Number(row.n)]))
    const startByDay = new Map(startDays.map((row) => [rawDay(row.day), Number(row.n)]))
    const daily: AdminStats['daily'] = []
    for (let i = 0; i < days; i += 1) {
      const key = dayKey(new Date(axisStart.getTime() + i * DAY_MS))
      daily.push({ date: key, newUsers: userByDay.get(key) ?? 0, starts: startByDay.get(key) ?? 0 })
    }
    const workIds = workRaw.map((row) => row.mpWorkId)
    const workRows = workIds.length
      ? await prisma.mpWork.findMany({ where: { id: { in: workIds } }, select: { id: true, title: true, ratingScore: true, ratingCount: true } })
      : []
    const workById = new Map(workRows.map((row) => [row.id, row]))
    const works: AdminStats['works'] = workRaw.flatMap((row) => {
      const work = workById.get(row.mpWorkId)
      if (!work) return []
      const rowStarts = Number(row.starts)
      return [{
        title: work.title,
        players: Number(row.players),
        completionRate: rowStarts > 0 ? Math.round((Number(row.completions) / rowStarts) * 1000) / 1000 : 0,
        shares: Number(row.shares),
        ratingScore: work.ratingScore,
        ratingCount: work.ratingCount,
      }]
    })
    const sources: AdminStats['sources'] = sourceGroups
      .map((group) => ({ source: group.firstSource ?? 'other', newUsers: group._count._all }))
      .sort((a, b) => b.newUsers - a.newUsers)
    const channelWorkIds = channelRows.flatMap((row) => (row.mpWorkId ? [row.mpWorkId] : []))
    const channelTopicIds = channelRows.flatMap((row) => (row.topicId ? [row.topicId] : []))
    const channelIds = channelRows.map((row) => row.id)
    const [channelWorks, channelTopics, channelNewUsers, channelPlays] = await Promise.all([
      channelWorkIds.length ? prisma.mpWork.findMany({ where: { id: { in: channelWorkIds } }, select: { id: true, title: true } }) : Promise.resolve([]),
      channelTopicIds.length ? prisma.mpTopic.findMany({ where: { id: { in: channelTopicIds } }, select: { id: true, title: true } }) : Promise.resolve([]),
      channelIds.length
        ? prisma.consumerUser.groupBy({ by: ['firstChannelId'], where: { firstChannelId: { in: channelIds }, createdAt: { gte: since } }, _count: { _all: true } })
        : Promise.resolve([]),
      channelIds.length
        ? prisma.mpEvent.findMany({
          where: { channelId: { in: channelIds }, name: 'play_start', createdAt: { gte: since }, consumerId: { not: null } },
          distinct: ['consumerId', 'channelId'],
          select: { consumerId: true, channelId: true },
        })
        : Promise.resolve([]),
    ])
    const channelWorkTitle = new Map(channelWorks.map((row) => [row.id, row.title]))
    const channelTopicTitle = new Map(channelTopics.map((row) => [row.id, row.title]))
    const channelNewUserCount = new Map<string, number>()
    for (const group of channelNewUsers) {
      if (group.firstChannelId) channelNewUserCount.set(group.firstChannelId, group._count._all)
    }
    const channelPlayerCount = new Map<string, number>()
    for (const event of channelPlays) {
      if (event.channelId) channelPlayerCount.set(event.channelId, (channelPlayerCount.get(event.channelId) ?? 0) + 1)
    }
    const channels: AdminStats['channels'] = channelRows.map((row) => ({
      name: row.name,
      target: (row.mpWorkId ? channelWorkTitle.get(row.mpWorkId) : row.topicId ? channelTopicTitle.get(row.topicId) : null) ?? '首页',
      newUsers: channelNewUserCount.get(row.id) ?? 0,
      players: channelPlayerCount.get(row.id) ?? 0,
    }))
    return {
      kpis: { newUsers, activeUsers: Number(activeRaw[0]?.n ?? 0), starts, completions, shares, shareNewUsers },
      daily,
      works,
      sources,
      channels,
    }
  })
}
