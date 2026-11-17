import { Prisma, type MpFeatureSlot, type MpTopic } from '@prisma/client'
import { ApiError } from '@/lib/api-errors'
import { emptyProfile, readProfile } from '@/lib/interactive/achievements'
import { emptySaves } from '@/lib/interactive/saves'
import { createScopedLogger } from '@/lib/logging/core'
import { prisma } from '@/lib/prisma'
import { redis } from '@/lib/redis'
import { mpMediaUrl, mpUrlExpiresAt } from '@/lib/storage/cdn'
import { MP_RATING_MIN_COUNT } from './constants'
import type { Card, ContinueCard, PlayManifest, Slot, TopicCard, WorkDetail } from './dto'
import { MpApiError } from './errors'
import type { ReleaseManifest, ReleaseMediaEntry, ReleaseMeta } from './release/types'

const logger = createScopedLogger({ module: 'mp-catalog' })

export const MP_SEARCH_LIMIT = { windowSeconds: 60, maxRequests: 30 }

const NEWEST_WINDOW_MS = 30 * 24 * 3600 * 1000

const VISIBLE_WHERE = { status: { in: ['live', 'scheduled'] }, work: { deletedAt: null } } satisfies Prisma.MpWorkWhereInput

const WORK_SELECT = {
  id: true, slug: true, status: true, scheduledAt: true, liveReleaseId: true, pendingReleaseId: true,
  firstLiveAt: true, playerCount: true, reserveCount: true, ratingCount: true, ratingScore: true,
} as const

type WorkRow = Prisma.MpWorkGetPayload<{ select: typeof WORK_SELECT }>

// 缓存里只存未签名的 storage key，签名在读出缓存之后、写响应之前现做（E.6）。
interface CardSource {
  slug: string
  title: string
  tagline: string
  coverKey: string
  accentColor: string
  tags: string[]
  status: 'live' | 'scheduled'
  players: number
  endingCount: number
  ratingScore: number | null
  scheduledAt?: string
  reserveCount?: number
}

interface SlotSource {
  title: string
  subtitle: string
  imageKey: string
  target: { type: 'work' | 'topic'; slug: string }
  card?: CardSource
}

interface TopicSource { slug: string; title: string; subtitle: string; coverKey: string }

interface HomeSource {
  hero: SlotSource[]
  picks: SlotSource[]
  hot: CardSource[]
  newest: CardSource[]
  upcoming: CardSource[]
  topics: TopicSource[]
}

interface DetailSource {
  card: CardSource
  synopsis: string
  creatorName: string
  shareCoverKey: string
  trailerKey: string | null
  trailerPosterKey: string | null
  chapterCount: number
  totalDurationSec: number
  ratingCount: number
  aspectRatio: string
  releaseId: string
  version: number
  chapters: { order: number; title: string; durationSec: number }[]
  endings: { projectId: string; nodeId: string; endingType: 'good' | 'normal' | 'bad' | 'hidden'; title: string }[]
  achievements: { id: string; name: string; description: string; icon: string | null }[]
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

async function cached<T>(suffix: string, ttlSec: number, loader: () => Promise<T>): Promise<T> {
  const ver = (await redis.get('mp:cache:ver').catch(() => null)) ?? '0'
  return withCache(`mp:cache:${ver}:${suffix}`, ttlSec, loader)
}

function displayReleaseId(work: WorkRow): string | null {
  return work.status === 'live' ? work.liveReleaseId : work.pendingReleaseId
}

function cardSource(work: WorkRow, meta: ReleaseMeta): CardSource {
  const status = work.status === 'scheduled' ? 'scheduled' : 'live'
  return {
    slug: work.slug,
    title: meta.title,
    tagline: meta.tagline,
    coverKey: meta.cover,
    accentColor: meta.accentColor,
    tags: meta.tags,
    status,
    players: work.playerCount,
    endingCount: meta.endings.length,
    ratingScore: work.ratingCount >= MP_RATING_MIN_COUNT ? Math.round(work.ratingScore * 10) / 10 : null,
    ...(status === 'scheduled' && work.scheduledAt ? { scheduledAt: work.scheduledAt.toISOString(), reserveCount: work.reserveCount } : {}),
  }
}

async function toCard(source: CardSource): Promise<Card> {
  const { coverKey, ...rest } = source
  return { ...rest, cover: await mpMediaUrl(coverKey) }
}

async function metasFor(works: WorkRow[]): Promise<Map<string, ReleaseMeta>> {
  const ids = works.map(displayReleaseId).filter((id): id is string => Boolean(id))
  if (!ids.length) return new Map()
  const releases = await prisma.storyRelease.findMany({ where: { id: { in: ids } }, select: { id: true, meta: true } })
  const metas = new Map<string, ReleaseMeta>()
  for (const release of releases) if (release.meta) metas.set(release.id, release.meta as unknown as ReleaseMeta)
  return metas
}

async function cardsFor(works: WorkRow[]): Promise<CardSource[]> {
  const metas = await metasFor(works)
  return works.flatMap((work) => {
    const releaseId = displayReleaseId(work)
    const meta = releaseId ? metas.get(releaseId) : undefined
    return meta ? [cardSource(work, meta)] : []
  })
}

async function workBySlug(slug: string): Promise<WorkRow> {
  const id = await withCache(`mp:slug:${slug}`, 600, async () => {
    const row = await prisma.mpWork.findUnique({ where: { slug }, select: { id: true } })
    if (!row) throw new MpApiError('MP_WORK_NOT_FOUND')
    return row.id
  })
  const work = await prisma.mpWork.findFirst({ where: { id, ...VISIBLE_WHERE }, select: WORK_SELECT })
  if (!work) throw new MpApiError('MP_WORK_NOT_FOUND')
  return work
}

export type WorkSort = 'hot' | 'new' | 'rating'

const LIST_ORDERS: Record<WorkSort, Prisma.MpWorkOrderByWithRelationInput[]> = {
  hot: [{ hotScore: 'desc' }, { playerCount: 'desc' }, { id: 'asc' }],
  new: [{ firstLiveAt: 'desc' }, { id: 'asc' }],
  rating: [{ ratingScore: 'desc' }, { ratingCount: 'desc' }, { id: 'asc' }],
}

function clampLimit(raw: string | null): number {
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 1) return 20
  return Math.min(value, 50)
}

function encodeCursor(slug: string): string {
  return Buffer.from(slug, 'utf8').toString('base64url')
}

function decodeCursor(cursor: string): string {
  const slug = Buffer.from(cursor, 'base64url').toString('utf8')
  if (!slug || slug.length > 16) throw new MpApiError('MP_VALIDATION', { message: '分页参数无效' })
  return slug
}

export async function listWorks(params: { sort: string | null; tag: string | null; cursor: string | null; limit: string | null }): Promise<{ items: Card[]; nextCursor: string | null }> {
  const sort: WorkSort = params.sort === 'new' || params.sort === 'rating' ? params.sort : 'hot'
  const tag = params.tag?.trim() ?? ''
  const limit = clampLimit(params.limit)
  const cursorSlug = params.cursor ? decodeCursor(params.cursor) : null
  const sources = await cached(`list:${sort}:${tag}:${cursorSlug ?? ''}:${limit}`, 60, async () => {
    const works = await prisma.mpWork.findMany({
      where: { ...VISIBLE_WHERE, status: 'live', ...(tag ? { tags: { array_contains: tag } } : {}) },
      orderBy: LIST_ORDERS[sort],
      ...(cursorSlug ? { cursor: { slug: cursorSlug }, skip: 1 } : {}),
      take: limit,
      select: WORK_SELECT,
    })
    return cardsFor(works)
  })
  const items = await Promise.all(sources.map(toCard))
  const nextCursor = sources.length === limit ? encodeCursor(sources[sources.length - 1].slug) : null
  return { items, nextCursor }
}

export async function ranking(kind: string): Promise<{ items: Card[] }> {
  if (kind !== 'hot' && kind !== 'rating' && kind !== 'new' && kind !== 'reserve') {
    throw new MpApiError('MP_VALIDATION', { message: '榜单不存在' })
  }
  const sources = await cached(`rank:${kind}`, 300, async () => {
    const now = Date.now()
    const where: Prisma.MpWorkWhereInput = { ...VISIBLE_WHERE, status: kind === 'reserve' ? 'scheduled' : 'live' }
    if (kind === 'rating') where.ratingCount = { gte: MP_RATING_MIN_COUNT }
    if (kind === 'new') where.firstLiveAt = { gte: new Date(now - NEWEST_WINDOW_MS) }
    const orderBy: Prisma.MpWorkOrderByWithRelationInput[] = kind === 'reserve'
      ? [{ reserveCount: 'desc' }, { id: 'asc' }]
      : LIST_ORDERS[kind]
    const works = await prisma.mpWork.findMany({ where, orderBy, take: 50, select: WORK_SELECT })
    return cardsFor(works)
  })
  return { items: await Promise.all(sources.map(toCard)) }
}

export async function searchWorks(q: string): Promise<{ items: Card[] }> {
  const trimmed = q.trim()
  const length = [...trimmed].length
  if (length < 1 || length > 30) throw new MpApiError('MP_VALIDATION', { message: '搜索词需要 1–30 字' })
  const escaped = trimmed.replace(/[\\%_]/g, (char) => `\\${char}`)
  const works = await prisma.mpWork.findMany({
    where: {
      ...VISIBLE_WHERE,
      OR: [{ title: { contains: escaped } }, { tagline: { contains: escaped } }, { tags: { string_contains: escaped } }],
    },
    orderBy: LIST_ORDERS.hot,
    take: 20,
    select: WORK_SELECT,
  })
  return { items: await Promise.all((await cardsFor(works)).map(toCard)) }
}

function timeWindow(now: Date) {
  return {
    AND: [
      { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
      { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
    ],
  }
}

function topicWhere(now: Date): Prisma.MpTopicWhereInput {
  return { status: 'live', ...timeWindow(now) }
}

type SlotRow = MpFeatureSlot
type TopicRow = MpTopic

async function slotSources(rows: SlotRow[], now: Date): Promise<SlotSource[]> {
  const workIds = rows.flatMap((row) => (row.mpWorkId ? [row.mpWorkId] : []))
  const topicIds = rows.flatMap((row) => (row.topicId ? [row.topicId] : []))
  const [works, topics] = await Promise.all([
    workIds.length ? prisma.mpWork.findMany({ where: { id: { in: workIds }, ...VISIBLE_WHERE }, select: WORK_SELECT }) : Promise.resolve([] as WorkRow[]),
    topicIds.length ? prisma.mpTopic.findMany({ where: { id: { in: topicIds }, ...topicWhere(now) } }) : Promise.resolve([] as TopicRow[]),
  ])
  const metas = await metasFor(works)
  const workById = new Map(works.map((work) => [work.id, work]))
  const topicById = new Map(topics.map((topic) => [topic.id, topic]))
  const sources: SlotSource[] = []
  for (const row of rows) {
    if (row.mpWorkId) {
      const work = workById.get(row.mpWorkId)
      const releaseId = work ? displayReleaseId(work) : null
      const meta = work && releaseId ? metas.get(releaseId) : undefined
      if (!work || !meta) continue
      sources.push({
        title: row.title ?? meta.title,
        subtitle: row.subtitle ?? '',
        imageKey: row.imageKey ?? meta.cover,
        target: { type: 'work', slug: work.slug },
        card: cardSource(work, meta),
      })
    } else if (row.topicId) {
      const topic = topicById.get(row.topicId)
      if (!topic) continue
      sources.push({
        title: row.title ?? topic.title,
        subtitle: row.subtitle ?? topic.subtitle,
        imageKey: row.imageKey ?? topic.coverKey ?? '',
        target: { type: 'topic', slug: topic.slug },
      })
    }
  }
  return sources
}

async function toSlot(source: SlotSource): Promise<Slot> {
  return {
    title: source.title,
    subtitle: source.subtitle,
    image: source.imageKey ? await mpMediaUrl(source.imageKey) : '',
    target: source.target,
    ...(source.card ? { card: await toCard(source.card) } : {}),
  }
}

async function buildHome(): Promise<HomeSource> {
  const now = new Date()
  const slotOrder = [{ sort: 'asc' }, { id: 'asc' }] as const
  const [heroRows, pickRows, hotWorks, newestWorks, upcomingWorks, topicRows] = await Promise.all([
    prisma.mpFeatureSlot.findMany({ where: { placement: 'home_hero', enabled: true, ...timeWindow(now) }, orderBy: [...slotOrder], take: 5 }),
    prisma.mpFeatureSlot.findMany({ where: { placement: 'home_pick', enabled: true, ...timeWindow(now) }, orderBy: [...slotOrder], take: 10 }),
    prisma.mpWork.findMany({ where: { ...VISIBLE_WHERE, status: 'live' }, orderBy: LIST_ORDERS.hot, take: 5, select: WORK_SELECT }),
    prisma.mpWork.findMany({ where: { ...VISIBLE_WHERE, status: 'live', firstLiveAt: { gte: new Date(now.getTime() - NEWEST_WINDOW_MS) } }, orderBy: LIST_ORDERS.new, take: 10, select: WORK_SELECT }),
    prisma.mpWork.findMany({ where: { ...VISIBLE_WHERE, status: 'scheduled' }, orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }], take: 10, select: WORK_SELECT }),
    prisma.mpTopic.findMany({ where: topicWhere(now), orderBy: [...slotOrder], take: 10 }),
  ])
  const [hero, picks, hot, newest, upcoming] = await Promise.all([
    slotSources(heroRows, now),
    slotSources(pickRows, now),
    cardsFor(hotWorks),
    cardsFor(newestWorks),
    cardsFor(upcomingWorks),
  ])
  return {
    hero,
    picks,
    hot,
    newest,
    upcoming,
    topics: topicRows.map((topic) => ({ slug: topic.slug, title: topic.title, subtitle: topic.subtitle, coverKey: topic.coverKey ?? '' })),
  }
}

async function continuePlaying(consumerId: string): Promise<ContinueCard[]> {
  const saves = await prisma.consumerSave.findMany({
    where: { consumerId },
    orderBy: { lastPlayedAt: 'desc' },
    take: 10,
    select: { mpWorkId: true, progress: true, endingsGot: true, lastPlayedAt: true },
  })
  if (!saves.length) return []
  const works = await prisma.mpWork.findMany({ where: { id: { in: saves.map((save) => save.mpWorkId) }, ...VISIBLE_WHERE }, select: WORK_SELECT })
  const metas = await metasFor(works)
  const workById = new Map(works.map((work) => [work.id, work]))
  const cards: ContinueCard[] = []
  for (const save of saves) {
    const work = workById.get(save.mpWorkId)
    const releaseId = work ? displayReleaseId(work) : null
    const meta = work && releaseId ? metas.get(releaseId) : undefined
    if (!work || !meta) continue
    cards.push({
      card: await toCard(cardSource(work, meta)),
      progress: save.progress,
      endingsGot: save.endingsGot,
      lastPlayedAt: save.lastPlayedAt.toISOString(),
    })
  }
  return cards
}

export async function home(consumerId: string | null): Promise<{
  hero: Slot[]
  picks: Slot[]
  continue: ContinueCard[]
  hot: Card[]
  newest: Card[]
  upcoming: Card[]
  topics: TopicCard[]
}> {
  const source = await cached('home', 60, buildHome)
  const [hero, picks, hot, newest, upcoming, topics, continueCards] = await Promise.all([
    Promise.all(source.hero.map(toSlot)),
    Promise.all(source.picks.map(toSlot)),
    Promise.all(source.hot.map(toCard)),
    Promise.all(source.newest.map(toCard)),
    Promise.all(source.upcoming.map(toCard)),
    Promise.all(source.topics.map(async (topic): Promise<TopicCard> => ({
      slug: topic.slug, title: topic.title, subtitle: topic.subtitle,
      cover: topic.coverKey ? await mpMediaUrl(topic.coverKey) : '',
    }))),
    consumerId ? continuePlaying(consumerId) : Promise.resolve([] as ContinueCard[]),
  ])
  return { hero, picks, continue: continueCards, hot, newest, upcoming, topics }
}

export async function topicDetail(slug: string): Promise<{
  topic: { slug: string; title: string; subtitle: string; description: string; cover: string }
  items: Card[]
}> {
  const source = await cached(`topic:${slug}`, 300, async () => {
    const topic = await prisma.mpTopic.findFirst({ where: { slug, ...topicWhere(new Date()) } })
    if (!topic) throw new ApiError('NOT_FOUND', { message: '专题不存在' })
    const ids = Array.isArray(topic.mpWorkIds) ? (topic.mpWorkIds as unknown[]).filter((id): id is string => typeof id === 'string') : []
    const works = ids.length ? await prisma.mpWork.findMany({ where: { id: { in: ids }, ...VISIBLE_WHERE }, select: WORK_SELECT }) : []
    const workById = new Map(works.map((work) => [work.id, work]))
    const ordered = ids.flatMap((id) => {
      const work = workById.get(id)
      return work ? [work] : []
    })
    return {
      topic: { slug: topic.slug, title: topic.title, subtitle: topic.subtitle, description: topic.description, coverKey: topic.coverKey ?? '' },
      items: await cardsFor(ordered),
    }
  })
  return {
    topic: {
      slug: source.topic.slug,
      title: source.topic.title,
      subtitle: source.topic.subtitle,
      description: source.topic.description,
      cover: source.topic.coverKey ? await mpMediaUrl(source.topic.coverKey) : '',
    },
    items: await Promise.all(source.items.map(toCard)),
  }
}

function iconKey(icon: string | null, manifest: ReleaseManifest | null): string | null {
  if (!icon) return null
  const match = /^mp:([0-9a-f]{16})$/.exec(icon)
  if (!match) return icon
  return manifest?.media[match[1]]?.files.img ?? null
}

async function buildDetail(work: WorkRow): Promise<DetailSource> {
  const releaseId = displayReleaseId(work)
  const release = releaseId
    ? await prisma.storyRelease.findUnique({
      where: { id: releaseId },
      select: { id: true, version: true, meta: true, manifest: true, aspectRatio: true, chapterCount: true, totalDurationSec: true },
    })
    : null
  const meta = release?.meta as unknown as ReleaseMeta | null | undefined
  if (!release || !meta) throw new MpApiError('MP_WORK_NOT_FOUND')
  const manifest = (release.manifest as unknown as ReleaseManifest | null) ?? null
  return {
    card: cardSource(work, meta),
    synopsis: meta.synopsis,
    creatorName: meta.creatorName,
    shareCoverKey: meta.shareCover,
    trailerKey: meta.trailer,
    trailerPosterKey: meta.trailerPoster,
    chapterCount: release.chapterCount,
    totalDurationSec: release.totalDurationSec,
    ratingCount: work.ratingCount,
    aspectRatio: release.aspectRatio,
    releaseId: release.id,
    version: release.version,
    chapters: meta.chapters.map(({ order, title, durationSec }) => ({ order, title, durationSec })),
    endings: meta.endings.map(({ projectId, nodeId, endingType, title }) => ({ projectId, nodeId, endingType, title })),
    achievements: meta.achievements.map((achievement) => ({
      id: achievement.id, name: achievement.name, description: achievement.description,
      icon: iconKey(achievement.icon, manifest),
    })),
  }
}

async function detailViewer(consumerId: string, mpWorkId: string): Promise<NonNullable<WorkDetail['viewer']>> {
  const where = { consumerId_mpWorkId: { consumerId, mpWorkId } }
  const [save, favorite, rating, reservation] = await Promise.all([
    prisma.consumerSave.findUnique({ where, select: { profile: true, progress: true } }),
    prisma.consumerFavorite.findUnique({ where, select: { id: true } }),
    prisma.consumerRating.findUnique({ where, select: { score: true } }),
    prisma.mpReservation.findUnique({ where, select: { id: true } }),
  ])
  const profile = readProfile(save?.profile)
  return {
    favorited: Boolean(favorite),
    rating: rating?.score ?? null,
    reserved: Boolean(reservation),
    hasSave: Boolean(save),
    endingsGot: profile.endings,
    achievementsGot: profile.achievements,
    progress: save?.progress ?? 0,
  }
}

export async function workDetail(slug: string, consumerId: string | null): Promise<WorkDetail> {
  const work = await workBySlug(slug)
  const source = await cached(`work:${slug}`, 300, () => buildDetail(work))
  const viewer = consumerId ? await detailViewer(consumerId, work.id) : null
  const collectedEndings = new Set(viewer?.endingsGot ?? [])
  const [card, shareCover, trailerUrl, trailerPoster, achievements] = await Promise.all([
    toCard(source.card),
    mpMediaUrl(source.shareCoverKey),
    source.trailerKey ? mpMediaUrl(source.trailerKey) : Promise.resolve(null),
    source.trailerPosterKey ? mpMediaUrl(source.trailerPosterKey) : Promise.resolve(null),
    Promise.all(source.achievements.map(async (achievement) => ({
      ...achievement,
      icon: achievement.icon?.startsWith('mp/releases/') ? await mpMediaUrl(achievement.icon) : achievement.icon,
    }))),
  ])
  return {
    work: {
      ...card,
      synopsis: source.synopsis,
      creatorName: source.creatorName,
      shareCover,
      trailer: trailerUrl ? { url: trailerUrl, poster: trailerPoster ?? '' } : null,
      chapterCount: source.chapterCount,
      totalDurationSec: source.totalDurationSec,
      ratingCount: source.ratingCount,
      aspectRatio: source.aspectRatio,
      releaseId: source.releaseId,
      version: source.version,
    },
    chapters: source.chapters,
    endings: source.endings.map((ending) => ({
      nodeId: ending.nodeId,
      endingType: ending.endingType,
      title: collectedEndings.has(`${ending.projectId}:${ending.nodeId}`) ? ending.title : null,
    })),
    achievements,
    viewer,
  }
}

async function signMediaEntry(entry: ReleaseMediaEntry, nowSec: number): Promise<PlayManifest['media'][string]> {
  const { files } = entry
  const [v720, v480, poster, last, img] = await Promise.all([
    files.v720 ? mpMediaUrl(files.v720, nowSec) : Promise.resolve(undefined),
    files.v480 ? mpMediaUrl(files.v480, nowSec) : Promise.resolve(undefined),
    files.poster ? mpMediaUrl(files.poster, nowSec) : Promise.resolve(undefined),
    files.last ? mpMediaUrl(files.last, nowSec) : Promise.resolve(undefined),
    files.img ? mpMediaUrl(files.img, nowSec) : Promise.resolve(undefined),
  ])
  return {
    kind: entry.kind,
    w: entry.w,
    h: entry.h,
    ...(entry.durationSec !== undefined ? { dur: entry.durationSec } : {}),
    ...(v720 ? { v720 } : {}),
    ...(v480 ? { v480 } : {}),
    ...(poster ? { poster } : {}),
    ...(last ? { last } : {}),
    ...(img ? { img } : {}),
  }
}

async function ensureSave(consumerId: string, mpWorkId: string, releaseId: string): Promise<void> {
  try {
    const existing = await prisma.consumerSave.findUnique({ where: { consumerId_mpWorkId: { consumerId, mpWorkId } }, select: { id: true } })
    if (existing) {
      await prisma.consumerSave.update({ where: { id: existing.id }, data: { lastPlayedAt: new Date() } })
      return
    }
    await prisma.$transaction(async (tx) => {
      await tx.consumerSave.create({
        data: {
          consumerId, mpWorkId, releaseId,
          profile: emptyProfile() as unknown as Prisma.InputJsonValue,
          saves: emptySaves() as unknown as Prisma.InputJsonValue,
          permanent: {},
        },
      })
      await tx.mpWork.update({ where: { id: mpWorkId }, data: { playerCount: { increment: 1 } } })
    })
  } catch (error) {
    // 云存档初始化失败不影响游玩（红线：对观众静默），下次进入或 PUT 存档时再补。
    logger.warn({ action: 'mp.play.save_init_failed', message: '云存档初始化失败', details: { mpWorkId, error: error instanceof Error ? error.message : String(error) } })
  }
}

export async function playManifest(slug: string, consumerId: string): Promise<PlayManifest> {
  const work = await workBySlug(slug)
  if (work.status !== 'live' || !work.liveReleaseId) throw new MpApiError('MP_NOT_PLAYABLE')
  const release = await prisma.storyRelease.findUnique({
    where: { id: work.liveReleaseId },
    select: { id: true, version: true, aspectRatio: true, programKey: true, programHash: true, manifest: true },
  })
  const manifest = release?.manifest as unknown as ReleaseManifest | null | undefined
  if (!release?.programKey || !release.programHash || !manifest) throw new MpApiError('MP_NOT_PLAYABLE')
  const nowSec = Math.floor(Date.now() / 1000)
  const entries = await Promise.all(Object.entries(manifest.media).map(async ([id, entry]) => [id, await signMediaEntry(entry, nowSec)] as const))
  await ensureSave(consumerId, work.id, release.id)
  return {
    releaseId: release.id,
    version: release.version,
    aspectRatio: release.aspectRatio,
    programUrl: await mpMediaUrl(release.programKey, nowSec),
    programHash: release.programHash,
    media: Object.fromEntries(entries),
    expiresAt: mpUrlExpiresAt(nowSec),
    stats: `/api/mp/releases/${release.id}/stats`,
  }
}
