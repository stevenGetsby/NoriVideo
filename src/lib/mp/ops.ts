import { Prisma } from '@prisma/client'
import { ApiError } from '@/lib/api-errors'
import { prisma } from '@/lib/prisma'
import { mpMediaUrl } from '@/lib/storage/cdn'
import { createChannel, toChannelRow, urlLinkEnabled, type ChannelRow } from './channels'
import { MpApiError } from './errors'
import { newSlug } from './ids'

const SLOT_PLACEMENTS = ['home_hero', 'home_pick'] as const
const SLOT_MAX_ACTIVE: Record<string, number> = { home_hero: 5, home_pick: 8 }
const TOPIC_STATUSES = ['draft', 'live', 'ended'] as const
const WORK_STATUSES = ['draft', 'scheduled', 'live', 'offline', 'banned'] as const
const STATS_WINDOW_MS = 30 * 24 * 3600 * 1000

export const REPORT_REASON_LABEL: Record<string, string> = {
  vulgar: '低俗色情', violence: '暴力血腥', politics: '政治敏感',
  copyright: '侵犯版权', minor: '不适合未成年人', other: '其他',
}

function isP2002(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

function readString(value: unknown, max: number, message: string): string {
  if (typeof value !== 'string' || [...value.trim()].length > max) throw new MpApiError('MP_VALIDATION', { message })
  return value.trim()
}

function readOptionalString(value: unknown, max: number, message: string): string | null {
  if (value == null || value === '') return null
  return readString(value, max, message)
}

function readDate(value: unknown): Date | null {
  if (value == null || value === '') return null
  if (typeof value !== 'string') throw new MpApiError('MP_VALIDATION', { message: '时间格式无效' })
  const at = new Date(value)
  if (!Number.isFinite(at.getTime())) throw new MpApiError('MP_VALIDATION', { message: '时间格式无效' })
  return at
}

function slotActiveNow(startsAt: Date | null, endsAt: Date | null, now: Date): boolean {
  return (!startsAt || startsAt <= now) && (!endsAt || endsAt >= now)
}

// ---------- 推荐位 ----------

export interface OpsSlotRow {
  id: string
  placement: string
  mpWorkId: string | null
  topicId: string | null
  targetTitle: string
  title: string | null
  subtitle: string | null
  imageKey: string | null
  imageUrl: string | null
  sort: number
  startsAt: string | null
  endsAt: string | null
  enabled: boolean
}

export async function listOpsSlots(): Promise<{ items: OpsSlotRow[] }> {
  const rows = await prisma.mpFeatureSlot.findMany({ orderBy: [{ placement: 'asc' }, { sort: 'asc' }, { id: 'asc' }] })
  const workIds = rows.flatMap((row) => (row.mpWorkId ? [row.mpWorkId] : []))
  const topicIds = rows.flatMap((row) => (row.topicId ? [row.topicId] : []))
  const [works, topics] = await Promise.all([
    workIds.length ? prisma.mpWork.findMany({ where: { id: { in: workIds } }, select: { id: true, title: true } }) : Promise.resolve([]),
    topicIds.length ? prisma.mpTopic.findMany({ where: { id: { in: topicIds } }, select: { id: true, title: true } }) : Promise.resolve([]),
  ])
  const workTitle = new Map(works.map((work) => [work.id, work.title]))
  const topicTitle = new Map(topics.map((topic) => [topic.id, topic.title]))
  const items = await Promise.all(rows.map(async (row) => ({
    id: row.id,
    placement: row.placement,
    mpWorkId: row.mpWorkId,
    topicId: row.topicId,
    targetTitle: (row.mpWorkId ? workTitle.get(row.mpWorkId) : row.topicId ? topicTitle.get(row.topicId) : null) ?? '目标已删除',
    title: row.title,
    subtitle: row.subtitle,
    imageKey: row.imageKey,
    imageUrl: row.imageKey ? await mpMediaUrl(row.imageKey) : null,
    sort: row.sort,
    startsAt: row.startsAt?.toISOString() ?? null,
    endsAt: row.endsAt?.toISOString() ?? null,
    enabled: row.enabled,
  })))
  return { items }
}

export async function saveOpsSlot(body: Record<string, unknown>, id?: string): Promise<{ ok: true }> {
  const placement = body.placement
  if (!SLOT_PLACEMENTS.includes(placement as (typeof SLOT_PLACEMENTS)[number])) throw new MpApiError('MP_VALIDATION', { message: '推荐位无效' })
  const mpWorkId = typeof body.mpWorkId === 'string' && body.mpWorkId ? body.mpWorkId : null
  const topicId = typeof body.topicId === 'string' && body.topicId ? body.topicId : null
  if (Boolean(mpWorkId) === Boolean(topicId)) throw new MpApiError('MP_VALIDATION', { message: '作品和专题只能二选一' })
  if (mpWorkId) {
    const work = await prisma.mpWork.findUnique({ where: { id: mpWorkId }, select: { status: true } })
    if (!work) throw new MpApiError('MP_VALIDATION', { message: '作品不存在' })
    if (work.status !== 'live' && work.status !== 'scheduled') throw new MpApiError('MP_VALIDATION', { message: '只能选择已上线或待上线的作品' })
  }
  if (topicId) {
    const topic = await prisma.mpTopic.findUnique({ where: { id: topicId }, select: { id: true } })
    if (!topic) throw new MpApiError('MP_VALIDATION', { message: '专题不存在' })
  }
  const data = {
    placement: placement as string,
    mpWorkId,
    topicId,
    title: readOptionalString(body.title, 30, '标题需要 30 字以内'),
    subtitle: readOptionalString(body.subtitle, 40, '副标题需要 40 字以内'),
    imageKey: readOptionalString(body.imageKey, 255, '图片无效'),
    startsAt: readDate(body.startsAt),
    endsAt: readDate(body.endsAt),
    enabled: body.enabled !== false,
  }
  const now = new Date()
  if (data.enabled && slotActiveNow(data.startsAt, data.endsAt, now)) {
    const max = SLOT_MAX_ACTIVE[data.placement]
    const active = await prisma.mpFeatureSlot.count({
      where: {
        placement: data.placement, enabled: true, ...(id ? { id: { not: id } } : {}),
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
        ],
      },
    })
    if (active >= max) throw new MpApiError('MP_INVALID_STATE', { message: `同时生效的推荐位不能超过 ${max} 个` })
  }
  if (id) {
    const result = await prisma.mpFeatureSlot.updateMany({ where: { id }, data })
    if (result.count === 0) throw new ApiError('NOT_FOUND', { message: '推荐位不存在。' })
  } else {
    await prisma.mpFeatureSlot.create({ data })
  }
  return { ok: true }
}

export async function deleteOpsSlot(id: string): Promise<{ ok: true }> {
  const result = await prisma.mpFeatureSlot.deleteMany({ where: { id } })
  if (result.count === 0) throw new ApiError('NOT_FOUND', { message: '推荐位不存在。' })
  return { ok: true }
}

export async function moveOpsSlot(id: string, direction: 'up' | 'down'): Promise<{ ok: true }> {
  const slot = await prisma.mpFeatureSlot.findUnique({ where: { id }, select: { placement: true } })
  if (!slot) throw new ApiError('NOT_FOUND', { message: '推荐位不存在。' })
  const siblings = await prisma.mpFeatureSlot.findMany({ where: { placement: slot.placement }, orderBy: [{ sort: 'asc' }, { id: 'asc' }], select: { id: true } })
  const ids = siblings.map((row) => row.id)
  const index = ids.indexOf(id)
  const target = direction === 'up' ? index - 1 : index + 1
  if (index < 0 || target < 0 || target >= ids.length) return { ok: true }
  ids.splice(index, 1)
  ids.splice(target, 0, id)
  await prisma.$transaction(ids.map((slotId, position) => prisma.mpFeatureSlot.update({ where: { id: slotId }, data: { sort: position } })))
  return { ok: true }
}

// ---------- 专题 ----------

export interface OpsTopicRow {
  id: string
  slug: string
  title: string
  subtitle: string
  description: string
  coverKey: string | null
  coverUrl: string | null
  works: Array<{ id: string; title: string }>
  status: string
  startsAt: string | null
  endsAt: string | null
  createdAt: string
}

export async function listOpsTopics(): Promise<{ items: OpsTopicRow[] }> {
  const rows = await prisma.mpTopic.findMany({ orderBy: [{ createdAt: 'desc' }] })
  const workIds = [...new Set(rows.flatMap((row) => (Array.isArray(row.mpWorkIds) ? row.mpWorkIds.filter((value): value is string => typeof value === 'string') : [])))]
  const works = workIds.length ? await prisma.mpWork.findMany({ where: { id: { in: workIds } }, select: { id: true, title: true } }) : []
  const workById = new Map(works.map((work) => [work.id, work]))
  const items = await Promise.all(rows.map(async (row) => {
    const ids = Array.isArray(row.mpWorkIds) ? row.mpWorkIds.filter((value): value is string => typeof value === 'string') : []
    return {
      id: row.id,
      slug: row.slug,
      title: row.title,
      subtitle: row.subtitle,
      description: row.description,
      coverKey: row.coverKey,
      coverUrl: row.coverKey ? await mpMediaUrl(row.coverKey) : null,
      works: ids.flatMap((workId) => {
        const work = workById.get(workId)
        return work ? [work] : []
      }),
      status: row.status,
      startsAt: row.startsAt?.toISOString() ?? null,
      endsAt: row.endsAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    }
  }))
  return { items }
}

export async function saveOpsTopic(body: Record<string, unknown>, id?: string): Promise<{ ok: true }> {
  const title = readString(body.title, 30, '标题需要 1–30 字')
  if (!title) throw new MpApiError('MP_VALIDATION', { message: '标题需要 1–30 字' })
  const subtitle = readString(body.subtitle ?? '', 60, '副标题需要 60 字以内')
  const description = typeof body.description === 'string' ? body.description.trim() : ''
  if (!description) throw new MpApiError('MP_VALIDATION', { message: '请填写介绍' })
  const coverKey = readOptionalString(body.coverKey, 255, '封面无效')
  const rawIds = Array.isArray(body.mpWorkIds) ? body.mpWorkIds.filter((value): value is string => typeof value === 'string' && Boolean(value)) : []
  const mpWorkIds = [...new Set(rawIds)]
  if (mpWorkIds.length < 2 || mpWorkIds.length > 30) throw new MpApiError('MP_VALIDATION', { message: '作品列表需要 2–30 部' })
  const existing = await prisma.mpWork.count({ where: { id: { in: mpWorkIds } } })
  if (existing !== mpWorkIds.length) throw new MpApiError('MP_VALIDATION', { message: '作品不存在' })
  const status = body.status
  if (!TOPIC_STATUSES.includes(status as (typeof TOPIC_STATUSES)[number])) throw new MpApiError('MP_VALIDATION', { message: '状态无效' })
  const data = {
    title, subtitle, description, coverKey, mpWorkIds,
    status: status as string,
    startsAt: readDate(body.startsAt),
    endsAt: readDate(body.endsAt),
  }
  if (id) {
    const result = await prisma.mpTopic.updateMany({ where: { id }, data })
    if (result.count === 0) throw new ApiError('NOT_FOUND', { message: '专题不存在。' })
    return { ok: true }
  }
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await prisma.mpTopic.create({ data: { ...data, slug: newSlug() } })
      return { ok: true }
    } catch (error) {
      if (!isP2002(error)) throw error
    }
  }
  throw new MpApiError('MP_INVALID_STATE', { message: '专题创建失败，请重试' })
}

export async function deleteOpsTopic(id: string): Promise<{ ok: true }> {
  const result = await prisma.mpTopic.deleteMany({ where: { id } })
  if (result.count === 0) throw new ApiError('NOT_FOUND', { message: '专题不存在。' })
  return { ok: true }
}

// ---------- 运营渠道 ----------

export interface OpsChannelRow extends ChannelRow {
  target: string
}

export async function listOpsChannels(): Promise<{ urlLinkEnabled: boolean; channels: OpsChannelRow[] }> {
  const rows = await prisma.mpChannel.findMany({ where: { kind: 'ops', archived: false }, orderBy: { createdAt: 'desc' } })
  const workIds = rows.flatMap((row) => (row.mpWorkId ? [row.mpWorkId] : []))
  const topicIds = rows.flatMap((row) => (row.topicId ? [row.topicId] : []))
  const [works, topics] = await Promise.all([
    workIds.length ? prisma.mpWork.findMany({ where: { id: { in: workIds } }, select: { id: true, slug: true, title: true } }) : Promise.resolve([]),
    topicIds.length ? prisma.mpTopic.findMany({ where: { id: { in: topicIds } }, select: { id: true, slug: true, title: true } }) : Promise.resolve([]),
  ])
  const workById = new Map(works.map((work) => [work.id, work]))
  const topicById = new Map(topics.map((topic) => [topic.id, topic]))
  const ids = rows.map((row) => row.id)
  const since = new Date(Date.now() - STATS_WINDOW_MS)
  const [newUserGroups, playEvents] = ids.length
    ? await Promise.all([
      prisma.consumerUser.groupBy({ by: ['firstChannelId'], where: { firstChannelId: { in: ids }, createdAt: { gte: since } }, _count: { _all: true } }),
      prisma.mpEvent.findMany({
        where: { channelId: { in: ids }, name: 'play_start', createdAt: { gte: since }, consumerId: { not: null } },
        distinct: ['consumerId', 'channelId'],
        select: { consumerId: true, channelId: true },
      }),
    ])
    : [[], []]
  const newUsers = new Map<string, number>()
  for (const group of newUserGroups) {
    if (group.firstChannelId) newUsers.set(group.firstChannelId, group._count._all)
  }
  const players = new Map<string, number>()
  for (const event of playEvents) {
    if (event.channelId) players.set(event.channelId, (players.get(event.channelId) ?? 0) + 1)
  }
  const channels = await Promise.all(rows.map(async (row) => {
    const work = row.mpWorkId ? workById.get(row.mpWorkId) : null
    const topic = row.topicId ? topicById.get(row.topicId) : null
    const base = await toChannelRow(row, work?.slug ?? topic?.slug ?? null, newUsers.get(row.id) ?? 0, players.get(row.id) ?? 0)
    return { ...base, target: work ? work.title : topic ? topic.title : '首页' }
  }))
  return { urlLinkEnabled: urlLinkEnabled(), channels }
}

export async function createOpsChannel(body: Record<string, unknown>, userId: string): Promise<{ ok: true }> {
  await createChannel({
    kind: 'ops',
    name: typeof body.name === 'string' ? body.name : '',
    mpWorkId: typeof body.mpWorkId === 'string' && body.mpWorkId ? body.mpWorkId : null,
    topicId: typeof body.topicId === 'string' && body.topicId ? body.topicId : null,
    userId,
  })
  return { ok: true }
}

export async function archiveOpsChannel(id: string): Promise<{ ok: true }> {
  const result = await prisma.mpChannel.updateMany({ where: { id, kind: 'ops', archived: false }, data: { archived: true } })
  if (result.count === 0) throw new MpApiError('MP_VALIDATION', { message: '渠道不存在' })
  return { ok: true }
}

// ---------- 作品管理 ----------

export interface OpsWorkRow {
  id: string
  slug: string
  title: string
  status: string
  liveVersion: number | null
  playerCount: number
  ratingScore: number
  ratingCount: number
  createdAt: string
}

export async function listOpsWorks(status: string | null, q: string | null): Promise<{ items: OpsWorkRow[] }> {
  const where: Prisma.MpWorkWhereInput = {}
  if (status && WORK_STATUSES.includes(status as (typeof WORK_STATUSES)[number])) where.status = status
  const trimmed = (q ?? '').trim()
  if (trimmed) {
    const escaped = trimmed.replace(/[\\%_]/g, (char) => `\\${char}`)
    where.OR = [{ title: { contains: escaped } }, { slug: { contains: escaped } }]
  }
  const rows = await prisma.mpWork.findMany({ where, orderBy: { createdAt: 'desc' }, take: 200 })
  const releaseIds = rows.flatMap((row) => (row.liveReleaseId ? [row.liveReleaseId] : []))
  const releases = releaseIds.length ? await prisma.storyRelease.findMany({ where: { id: { in: releaseIds } }, select: { id: true, version: true } }) : []
  const versionById = new Map(releases.map((release) => [release.id, release.version]))
  return {
    items: rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      title: row.title,
      status: row.status,
      liveVersion: row.liveReleaseId ? versionById.get(row.liveReleaseId) ?? null : null,
      playerCount: row.playerCount,
      ratingScore: row.ratingScore,
      ratingCount: row.ratingCount,
      createdAt: row.createdAt.toISOString(),
    })),
  }
}

// ---------- 举报 ----------

export interface OpsReportRow {
  id: string
  workTitle: string
  reason: string
  reasonLabel: string
  detail: string
  createdAt: string
  workReportCount: number
}

export async function listOpsReports(): Promise<{ items: OpsReportRow[] }> {
  const rows = await prisma.mpReport.findMany({ where: { status: 'open' }, orderBy: { createdAt: 'desc' }, take: 200 })
  const workIds = [...new Set(rows.map((row) => row.mpWorkId))]
  const [works, counts] = await Promise.all([
    workIds.length ? prisma.mpWork.findMany({ where: { id: { in: workIds } }, select: { id: true, title: true } }) : Promise.resolve([]),
    prisma.mpReport.groupBy({ by: ['mpWorkId'], _count: { _all: true } }),
  ])
  const workTitle = new Map(works.map((work) => [work.id, work.title]))
  const countByWork = new Map(counts.map((group) => [group.mpWorkId, group._count._all]))
  return {
    items: rows.map((row) => ({
      id: row.id,
      workTitle: workTitle.get(row.mpWorkId) ?? '作品已删除',
      reason: row.reason,
      reasonLabel: REPORT_REASON_LABEL[row.reason] ?? row.reason,
      detail: row.detail,
      createdAt: row.createdAt.toISOString(),
      workReportCount: countByWork.get(row.mpWorkId) ?? 0,
    })),
  }
}

export async function updateOpsReport(id: string, status: unknown, adminId: string): Promise<{ ok: true }> {
  if (status !== 'resolved' && status !== 'dismissed') throw new MpApiError('MP_VALIDATION', { message: '状态无效' })
  const result = await prisma.mpReport.updateMany({ where: { id, status: 'open' }, data: { status, handledById: adminId, handledAt: new Date() } })
  if (result.count === 0) throw new ApiError('NOT_FOUND', { message: '举报不存在。' })
  return { ok: true }
}
