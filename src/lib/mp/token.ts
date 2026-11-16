import { createHmac, timingSafeEqual } from 'crypto'
import { MP_JWT_TTL_DAYS } from './constants'

export interface MpTokenPayload {
  sub: string
  ver: number
  aud: 'mp'
  iat: number
  exp: number
}

const TTL_SEC = MP_JWT_TTL_DAYS * 24 * 3600
export const MP_TOKEN_RENEW_WINDOW_SEC = 7 * 24 * 3600

function secret(): string {
  const value = process.env.MP_JWT_SECRET?.trim()
  if (!value) throw new Error('MP_JWT_SECRET is not configured')
  return value
}

const hmac = (data: string) => createHmac('sha256', secret()).update(data).digest()

export function signConsumerToken(sub: string, ver: number, nowSec = Math.floor(Date.now() / 1000)): { token: string; expiresAt: string } {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const payload: MpTokenPayload = { sub, ver, aud: 'mp', iat: nowSec, exp: nowSec + TTL_SEC }
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signature = hmac(`${header}.${body}`).toString('base64url')
  return { token: `${header}.${body}.${signature}`, expiresAt: new Date(payload.exp * 1000).toISOString() }
}

export function verifyConsumerToken(token: string, nowSec = Math.floor(Date.now() / 1000)): MpTokenPayload | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [header, body, signature] = parts
  let expected: Buffer
  try {
    expected = hmac(`${header}.${body}`)
  } catch {
    return null
  }
  const actual = Buffer.from(signature, 'base64url')
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null
  try {
    const parsedHeader = JSON.parse(Buffer.from(header, 'base64url').toString('utf8')) as { alg?: unknown }
    if (parsedHeader.alg !== 'HS256') return null
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as MpTokenPayload
    if (payload.aud !== 'mp') return null
    if (typeof payload.sub !== 'string' || !payload.sub) return null
    if (!Number.isInteger(payload.ver) || payload.ver < 0) return null
    if (!Number.isInteger(payload.iat) || !Number.isInteger(payload.exp)) return null
    if (payload.exp <= nowSec) return null
    return payload
  } catch {
    return null
  }
}

export function tokenNeedsRenewal(payload: MpTokenPayload, nowSec = Math.floor(Date.now() / 1000)): boolean {
  return payload.exp - nowSec < MP_TOKEN_RENEW_WINDOW_SEC
}
