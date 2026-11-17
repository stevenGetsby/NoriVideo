export type AttrSource =
  | 'channel' | 'share' | 'qrcode' | 'timeline' | 'subscribe'
  | 'official_account' | 'channels' | 'url_link' | 'search' | 'recent' | 'other'

export interface AttrQuery {
  c?: string
  s?: string
  w?: string
  t?: string
}

export interface Attribution {
  source: AttrSource
  c?: string
  s?: string
  w?: string
  at: number
}

export const ATTR_TTL_MS = 30 * 60 * 1000

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

export function buildAttribution(scene: number | undefined | null, query: AttrQuery, now: number): Attribution {
  const attr: Attribution = { source: sourceOf(scene, query), at: now }
  if (query.c) attr.c = query.c
  if (query.s) attr.s = query.s
  if (query.w) attr.w = query.w
  return attr
}

export function attrValid(attr: Attribution | null | undefined, now: number): boolean {
  return !!attr && typeof attr.at === 'number' && now - attr.at >= 0 && now - attr.at < ATTR_TTL_MS
}

// 当前归因 30 分钟内只写一次：窗口内沿用首触，过期或缺失才用新值替换。
export function resolveAttribution(prev: Attribution | null | undefined, incoming: Attribution, now: number): Attribution {
  return attrValid(prev, now) ? (prev as Attribution) : incoming
}
