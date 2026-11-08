import { createHmac, timingSafeEqual } from 'node:crypto'

const HANDLE_VERSION = 1
const DEFAULT_TTL_MS = 2 * 60 * 60 * 1_000
const MAX_TOKEN_LENGTH = 4_096
const MAX_FILE_ID_LENGTH = 500

export interface VideoRepaintFileHandlePayload {
  userId: string
  fileId: string
  durationSeconds: number
  episodeNumber: number
  expiresAt: number
}

interface SignedPayload {
  v: number
  uid: string
  fid: string
  dur: number
  ep: number
  exp: number
}

function compact(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readSecret(): string {
  return compact(process.env.VIDEO_REPAINT_FILE_HANDLE_SECRET)
    || compact(process.env.NEXTAUTH_SECRET)
    || compact(process.env.API_ENCRYPTION_KEY)
}

export function isVideoRepaintFileHandleConfigured(): boolean {
  return Boolean(readSecret())
}

function requireSecret(): string {
  const secret = readSecret()
  if (!secret) {
    throw new Error('VIDEO_REPAINT_FILE_HANDLE_SECRET_MISSING: signed video handle secret is not configured')
  }
  return secret
}

function sign(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('base64url')
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  if (leftBuffer.length !== rightBuffer.length) return false
  return timingSafeEqual(leftBuffer, rightBuffer)
}

function finitePositive(value: unknown, max: number): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= max ? value : null
}

export function createVideoRepaintFileHandle(
  input: Omit<VideoRepaintFileHandlePayload, 'expiresAt'>,
  options?: { ttlMs?: number; now?: number },
): string {
  const userId = compact(input.userId)
  const fileId = compact(input.fileId)
  const durationSeconds = finitePositive(input.durationSeconds, 6 * 60 * 60)
  const episodeNumber = Number.isInteger(input.episodeNumber) && input.episodeNumber >= 1 && input.episodeNumber <= 999
    ? input.episodeNumber
    : null
  if (!userId || !fileId || fileId.length > MAX_FILE_ID_LENGTH || durationSeconds === null || episodeNumber === null) {
    throw new Error('VIDEO_REPAINT_FILE_HANDLE_INVALID: cannot sign an invalid video handle')
  }

  const ttlMs = typeof options?.ttlMs === 'number' && Number.isFinite(options.ttlMs) && options.ttlMs > 0
    ? Math.min(options.ttlMs, 24 * 60 * 60 * 1_000)
    : DEFAULT_TTL_MS
  const payload: SignedPayload = {
    v: HANDLE_VERSION,
    uid: userId,
    fid: fileId,
    dur: durationSeconds,
    ep: episodeNumber,
    exp: (options?.now ?? Date.now()) + ttlMs,
  }
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  return `${body}.${sign(body, requireSecret())}`
}

export function verifyVideoRepaintFileHandle(
  token: unknown,
  userId: string,
  options?: { now?: number },
): VideoRepaintFileHandlePayload | null {
  const value = compact(token)
  const owner = compact(userId)
  if (!value || value.length > MAX_TOKEN_LENGTH || !owner) return null

  const separator = value.lastIndexOf('.')
  if (separator <= 0 || separator >= value.length - 1) return null
  const body = value.slice(0, separator)
  const signature = value.slice(separator + 1)
  let secret: string
  try {
    secret = requireSecret()
  } catch {
    return null
  }
  if (!safeEqual(signature, sign(body, secret))) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const payload = parsed as Partial<SignedPayload>
  if (payload.v !== HANDLE_VERSION || payload.uid !== owner) return null
  const fileId = compact(payload.fid)
  const durationSeconds = finitePositive(payload.dur, 6 * 60 * 60)
  const episodeNumber = Number.isInteger(payload.ep) && (payload.ep as number) >= 1 && (payload.ep as number) <= 999
    ? payload.ep as number
    : null
  const expiresAt = typeof payload.exp === 'number' && Number.isFinite(payload.exp) ? payload.exp : null
  if (!fileId || fileId.length > MAX_FILE_ID_LENGTH || durationSeconds === null || episodeNumber === null || expiresAt === null) {
    return null
  }
  if (expiresAt <= (options?.now ?? Date.now())) return null

  return {
    userId: owner,
    fileId,
    durationSeconds,
    episodeNumber,
    expiresAt,
  }
}
