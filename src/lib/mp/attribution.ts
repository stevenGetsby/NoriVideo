import { prisma } from '@/lib/prisma'
import { isChannelCode, isShareId, isSlug } from './ids'

// 与 miniprogram/lib/attribution.ts 的场景分桶表保持一致（H.5）；登录首触在服务端用同一口径。
export type AttrSource =
  | 'channel' | 'share' | 'qrcode' | 'timeline' | 'subscribe'
  | 'official_account' | 'channels' | 'url_link' | 'search' | 'recent' | 'other'

export interface AttrQuery {
  c?: string
  s?: string
  w?: string
  t?: string
}

const SCENE_SOURCE: Record<number, AttrSource> = {
  1007: 'share', 1008: 'share', 1036: 'share', 1044: 'share',
  1011: 'qrcode', 1012: 'qrcode', 1013: 'qrcode', 1047: 'qrcode', 1048: 'qrcode', 1049: 'qrcode',
  1154: 'timeline', 1155: 'timeline',
  1014: 'subscribe',
  1035: 'official_account', 1043: 'official_account', 1058: 'official_account', 1074: 'official_account',
  1175: 'channels', 1176: 'channels', 1177: 'channels', 1184: 'channels', 1191: 'channels',
  1065: 'url_link', 1194: 'url_link',
  1005: 'search', 1006: 'search', 1027: 'search', 1042: 'search', 1053: 'search',
  1001: 'recent', 1089: 'recent', 1104: 'recent',
}

export function sourceOf(scene: number | undefined | null, query: AttrQuery): AttrSource {
  if (query.c) return 'channel'
  if (query.s) return 'share'
  if (scene != null && SCENE_SOURCE[scene]) return SCENE_SOURCE[scene]
  return 'other'
}

export function parseScene(raw: string | undefined | null): AttrQuery {
  const out: AttrQuery = {}
  if (!raw) return out
  let decoded: string
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    decoded = raw
  }
  for (const pair of decoded.split('&')) {
    const eq = pair.indexOf('=')
    if (eq <= 0) continue
    const key = pair.slice(0, eq)
    const value = pair.slice(eq + 1)
    if (!value) continue
    if (key === 'c' || key === 's' || key === 'w' || key === 't') out[key] = value
  }
  return out
}

export interface LaunchAttr {
  source: AttrSource
  c: string | null
  s: string | null
  w: string | null
}

export function resolveLaunch(launch: unknown): LaunchAttr {
  const obj = launch && typeof launch === 'object' ? (launch as { scene?: unknown; query?: unknown }) : {}
  const sceneNum = typeof obj.scene === 'number' ? obj.scene : Number(obj.scene)
  const rawQuery = obj.query && typeof obj.query === 'object' ? (obj.query as Record<string, unknown>) : {}
  const str = (value: unknown): string | undefined => (typeof value === 'string' && value ? value : undefined)
  const fromScene = parseScene(str(rawQuery.scene))
  const query: AttrQuery = {
    c: str(rawQuery.c) || fromScene.c,
    s: str(rawQuery.s) || fromScene.s,
    w: str(rawQuery.w) || fromScene.w,
    t: str(rawQuery.t) || fromScene.t,
  }
  return {
    source: sourceOf(Number.isFinite(sceneNum) ? sceneNum : null, query),
    c: query.c ?? null,
    s: query.s ?? null,
    w: query.w ?? null,
  }
}

export interface FirstTouch {
  firstChannelId: string | null
  firstShareId: string | null
  firstMpWorkId: string | null
}

// 首触归因尽力而为：任何查询失败都不阻断登录（H.5）。
export async function resolveFirstTouch(attr: LaunchAttr): Promise<FirstTouch> {
  const out: FirstTouch = { firstChannelId: null, firstShareId: null, firstMpWorkId: null }
  if (attr.c && isChannelCode(attr.c)) {
    const channel = await prisma.mpChannel.findUnique({ where: { code: attr.c }, select: { id: true } }).catch(() => null)
    out.firstChannelId = channel?.id ?? null
  }
  if (attr.s && isShareId(attr.s)) {
    const share = await prisma.mpShare.findUnique({ where: { id: attr.s }, select: { id: true } }).catch(() => null)
    if (share) {
      out.firstShareId = share.id
      await prisma.mpShare.update({ where: { id: share.id }, data: { newUsers: { increment: 1 } } }).catch(() => undefined)
    }
  }
  if (attr.w && isSlug(attr.w)) {
    const work = await prisma.mpWork.findUnique({ where: { slug: attr.w }, select: { id: true } }).catch(() => null)
    out.firstMpWorkId = work?.id ?? null
  }
  return out
}
