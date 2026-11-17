import { prisma } from '@/lib/prisma'
import { redis } from '@/lib/redis'
import { MP_EVENT_BATCH_MAX } from './constants'
import { MpApiError } from './errors'
import { isChannelCode, isShareId, isSlug } from './ids'

export const MP_TRACK_LIMIT = { windowSeconds: 60, maxRequests: 60 }

const EVENT_NAMES = new Set([
  'app_launch', 'work_view', 'play_start', 'segment_view', 'choice_made', 'interaction_result',
  'ending_reached', 'play_exit', 'share_click', 'poster_create', 'favorite', 'rate', 'reserve', 'search',
])
const TS_PAST_MS = 7 * 24 * 3600 * 1000
const TS_FUTURE_MS = 5 * 60 * 1000
const CHANNEL_CACHE_SEC = 600
const INT32_MAX = 2147483647
const INT32_MIN = -2147483648

function clip(value: unknown, max: number): string | null {
  if (typeof value !== 'string' || !value) return null
  return [...value].slice(0, max).join('')
}

export function trackAnonId(body: unknown): string | null {
  const raw = body && typeof body === 'object' ? (body as Record<string, unknown>).anonId : null
  return clip(raw, 32)
}

async function channelIdOf(code: unknown): Promise<string | null> {
  if (typeof code !== 'string' || !isChannelCode(code)) return null
  const key = `mp:chan:${code}`
  const hit = await redis.get(key).catch(() => null)
  if (hit != null) return hit || null
  const channel = await prisma.mpChannel.findUnique({ where: { code }, select: { id: true } }).catch(() => null)
  await redis.set(key, channel?.id ?? '', 'EX', CHANNEL_CACHE_SEC).catch(() => undefined)
  return channel?.id ?? null
}

export async function ingestEvents(body: unknown, consumerId: string | null): Promise<{ accepted: number }> {
  const raw = body && typeof body === 'object' ? body as Record<string, unknown> : {}
  const anonId = trackAnonId(raw)
  if (!anonId) throw new MpApiError('MP_VALIDATION', { message: '请求格式无效' })
  const events = Array.isArray(raw.events) ? raw.events.slice(0, MP_EVENT_BATCH_MAX) : []
  const attr = raw.attr && typeof raw.attr === 'object' ? raw.attr as Record<string, unknown> : {}
  const source = clip(attr.source, 24)
  const channelId = await channelIdOf(attr.c)
  const shareId = typeof attr.s === 'string' && isShareId(attr.s) ? attr.s : null

  const slugs = [...new Set(events.flatMap((event) => {
    const slug = event && typeof event === 'object' ? (event as Record<string, unknown>).w : null
    return typeof slug === 'string' && isSlug(slug) ? [slug] : []
  }))]
  const works = slugs.length
    ? await prisma.mpWork.findMany({ where: { slug: { in: slugs } }, select: { id: true, slug: true } })
    : []
  const workBySlug = new Map(works.map((work) => [work.slug, work.id]))

  const now = Date.now()
  const rows: Array<{
    name: string; consumerId: string | null; anonId: string; sessionId: string
    mpWorkId: string | null; releaseId: string | null; nodeId: string | null; optionId: string | null
    value: number | null; flag: boolean | null; source: string | null; channelId: string | null; shareId: string | null
    clientTs: Date
  }> = []
  for (const item of events) {
    if (!item || typeof item !== 'object') continue
    const event = item as Record<string, unknown>
    const name = typeof event.name === 'string' ? event.name : ''
    if (!EVENT_NAMES.has(name)) continue
    const sessionId = clip(event.sid, 32)
    if (!sessionId) continue
    const slug = typeof event.w === 'string' ? event.w : ''
    const mpWorkId = slug ? workBySlug.get(slug) ?? null : null
    if (slug && !mpWorkId) continue
    const ts = typeof event.ts === 'number' && Number.isFinite(event.ts) && event.ts >= now - TS_PAST_MS && event.ts <= now + TS_FUTURE_MS
      ? event.ts
      : now
    rows.push({
      name,
      consumerId,
      anonId,
      sessionId,
      mpWorkId,
      releaseId: clip(event.r, 191),
      nodeId: clip(event.n, 64),
      optionId: clip(event.o, 64),
      value: typeof event.v === 'number' && Number.isFinite(event.v) ? Math.max(INT32_MIN, Math.min(INT32_MAX, Math.trunc(event.v))) : null,
      flag: typeof event.f === 'boolean' ? event.f : null,
      source,
      channelId,
      shareId,
      clientTs: new Date(ts),
    })
  }
  if (rows.length) await prisma.mpEvent.createMany({ data: rows })
  return { accepted: rows.length }
}
