import { prisma } from '@/lib/prisma'
import { MP_EVENT_BATCH_MAX } from '../constants'
import { MpApiError } from '../errors'
import { isShareId } from '../ids'
import { trackAnonId } from '../track'

// 已对照 player-controller.ts 的全部 this.track 调用：play_start / segment_view /
// choice_made / interaction_result / ending_reached / play_exit 都在白名单里（N9）。
const EVENT_NAMES = new Set([
  'app_launch', 'title_view', 'play_start', 'segment_view', 'choice_made', 'interaction_result',
  'ending_reached', 'play_exit', 'share_click', 'clip_share', 'sidebar_open', 'sidebar_claim',
  'guide_show', 'login_upgrade', 'ad_reward', 'video_error', 'storage_error',
])
const TS_PAST_MS = 7 * 24 * 3600 * 1000
const TS_FUTURE_MS = 5 * 60 * 1000
const INT32_MAX = 2147483647
const INT32_MIN = -2147483648

function clip(value: unknown, max: number): string | null {
  if (typeof value !== 'string' || !value) return null
  return [...value].slice(0, max).join('')
}

/** appId 来自 X-Dy-App 头并经 getDyApp 校验；上行没有 w，appId 就代表作品（N9）。 */
export async function ingestDyEvents(appId: string, body: unknown, userId: string | null): Promise<{ accepted: number }> {
  const raw = body && typeof body === 'object' ? body as Record<string, unknown> : {}
  const anonId = trackAnonId(raw)
  if (!anonId) throw new MpApiError('MP_VALIDATION', { message: '请求格式无效' })
  const events = Array.isArray(raw.events) ? raw.events.slice(0, MP_EVENT_BATCH_MAX) : []
  const attr = raw.attr && typeof raw.attr === 'object' ? raw.attr as Record<string, unknown> : {}
  const source = clip(attr.source, 24)
  const shareId = typeof attr.s === 'string' && isShareId(attr.s) ? attr.s : null

  const now = Date.now()
  const rows: Array<{
    appId: string; name: string; userId: string | null; anonId: string; sessionId: string
    releaseId: string | null; nodeId: string | null; optionId: string | null
    value: number | null; flag: boolean | null; source: string | null; shareId: string | null
    clientTs: Date
  }> = []
  for (const item of events) {
    if (!item || typeof item !== 'object') continue
    const event = item as Record<string, unknown>
    const name = typeof event.name === 'string' ? event.name : ''
    if (!EVENT_NAMES.has(name)) continue
    const sessionId = clip(event.sid, 32)
    if (!sessionId) continue
    const ts = typeof event.ts === 'number' && Number.isFinite(event.ts) && event.ts >= now - TS_PAST_MS && event.ts <= now + TS_FUTURE_MS
      ? event.ts
      : now
    rows.push({
      appId,
      name,
      userId,
      anonId,
      sessionId,
      releaseId: clip(event.r, 191),
      nodeId: clip(event.n, 64),
      optionId: clip(event.o, 64),
      value: typeof event.v === 'number' && Number.isFinite(event.v) ? Math.max(INT32_MIN, Math.min(INT32_MAX, Math.trunc(event.v))) : null,
      flag: typeof event.f === 'boolean' ? event.f : null,
      source,
      shareId,
      clientTs: new Date(ts),
    })
  }
  if (rows.length) await prisma.dyEvent.createMany({ data: rows })
  return { accepted: rows.length }
}