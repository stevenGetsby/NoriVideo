import { request } from './api'
import { attrValid, buildAttribution, parseScene, resolveAttribution, type Attribution, type AttrQuery } from './attribution'
import { wxStorage } from './storage'

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
const ANON_KEY = 'mp.anonId'
const SID_KEY = 'mp.sid'
const SID_AT_KEY = 'mp.sid.at'
const ATTR_KEY = 'mp.attr'
const QUEUE_KEY = 'mp.track.queue'
const SESSION_GAP_MS = 30 * 60 * 1000
const FLUSH_SIZE = 20
const FLUSH_INTERVAL_MS = 10000
const QUEUE_MAX = 200

export interface LaunchOptions {
  scene?: number
  query?: Record<string, string | undefined>
}

export interface TrackEvent {
  name: string
  ts: number
  sid: string
  w?: string
  r?: string
  n?: string
  o?: string
  v?: number
  f?: boolean
}

export type TrackFields = Partial<Omit<TrackEvent, 'name' | 'ts' | 'sid'>>

function randomId(len: number): string {
  let out = ''
  for (let i = 0; i < len; i += 1) out += BASE62[Math.floor(Math.random() * BASE62.length)]
  return out
}

let anonId = ''
let sessionId = ''
let attr: Attribution | null = null
let queue: TrackEvent[] = []
let timer: ReturnType<typeof setTimeout> | null = null
let flushing = false

function anon(): string {
  if (!anonId) {
    anonId = wxStorage.getItem(ANON_KEY) || ''
    if (!anonId) {
      anonId = randomId(16)
      wxStorage.setItem(ANON_KEY, anonId)
    }
  }
  return anonId
}

function ensureSession(now: number): void {
  if (!sessionId) sessionId = wxStorage.getItem(SID_KEY) || ''
  const lastAt = Number(wxStorage.getItem(SID_AT_KEY) || 0)
  if (!sessionId || now - lastAt > SESSION_GAP_MS) {
    sessionId = randomId(16)
    wxStorage.setItem(SID_KEY, sessionId)
  }
  wxStorage.setItem(SID_AT_KEY, String(now))
}

function readAttr(): Attribution | null {
  const raw = wxStorage.getItem(ATTR_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as Attribution
  } catch {
    return null
  }
}

export function captureAttribution(options: LaunchOptions): void {
  const now = Date.now()
  ensureSession(now)
  const raw = options.query || {}
  const fromScene = parseScene(raw.scene)
  const query: AttrQuery = {
    c: raw.c || fromScene.c,
    s: raw.s || fromScene.s,
    w: raw.w || fromScene.w,
    t: raw.t || fromScene.t,
  }
  const incoming = buildAttribution(options.scene, query, now)
  attr = resolveAttribution(readAttr(), incoming, now)
  wxStorage.setItem(ATTR_KEY, JSON.stringify(attr))
}

function persistFailed(events: TrackEvent[]): void {
  let stored: TrackEvent[] = []
  const raw = wxStorage.getItem(QUEUE_KEY)
  if (raw) {
    try {
      stored = JSON.parse(raw) as TrackEvent[]
    } catch {
      stored = []
    }
  }
  const combined = [...stored, ...events]
  const trimmed = combined.length > QUEUE_MAX ? combined.slice(combined.length - QUEUE_MAX) : combined
  try {
    wxStorage.setItem(QUEUE_KEY, JSON.stringify(trimmed))
  } catch {
    // 埋点失败永不影响页面
  }
}

function scheduleFlush(): void {
  if (timer) return
  timer = setTimeout(() => {
    timer = null
    flushTrack()
  }, FLUSH_INTERVAL_MS)
}

export function flushTrack(): void {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  if (flushing || queue.length === 0) return
  const events = queue
  queue = []
  flushing = true
  const payload = {
    anonId: anon(),
    attr: attr ? { source: attr.source, c: attr.c, s: attr.s } : undefined,
    events,
  }
  request('POST', '/api/mp/track', payload, { auth: 'none' })
    .catch(() => persistFailed(events))
    .finally(() => { flushing = false })
}

export function track(name: string, fields: TrackFields = {}): void {
  const now = Date.now()
  ensureSession(now)
  queue.push({ name, ts: now, sid: sessionId, ...fields })
  if (queue.length >= FLUSH_SIZE) flushTrack()
  else scheduleFlush()
}

export function initTrack(options: LaunchOptions): void {
  anon()
  captureAttribution(options)
  const raw = wxStorage.getItem(QUEUE_KEY)
  if (raw) {
    try {
      const stored = JSON.parse(raw) as TrackEvent[]
      if (Array.isArray(stored) && stored.length) {
        wxStorage.removeItem(QUEUE_KEY)
        queue = [...stored, ...queue]
        scheduleFlush()
      }
    } catch {
      // 损坏的补发队列直接丢弃
    }
  }
  track('app_launch')
}

export function noteShow(options: LaunchOptions): void {
  captureAttribution(options)
}

export function currentAttr(): Attribution | null {
  return attr && attrValid(attr, Date.now()) ? attr : null
}