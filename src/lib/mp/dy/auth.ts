import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { redis } from '@/lib/redis'
import type { RateLimitConfig } from '@/lib/rate-limit'
import { MpApiError } from '../errors'
import { signConsumerToken, tokenNeedsRenewal, verifyConsumerToken, type MpTokenPayload } from '../token'

export const DY_LOGIN_LIMIT: RateLimitConfig = { windowSeconds: 60, maxRequests: 20 }
export const DY_SAVE_LIMIT: RateLimitConfig = { windowSeconds: 60, maxRequests: 30 }
export const DY_TRACK_LIMIT: RateLimitConfig = { windowSeconds: 60, maxRequests: 60 }
export const DY_SHARE_LIMIT: RateLimitConfig = { windowSeconds: 60, maxRequests: 30 }

export interface DyUserRow {
  id: string
  appId: string
  openid: string | null
  anonOpenid: string | null
  unionid: string | null
  status: string
  tokenVersion: number
  firstSource: string | null
  firstShareId: string | null
}

export interface DyAuth {
  user: DyUserRow
  payload: MpTokenPayload
}

const USER_CACHE_TTL_SEC = 60
export const DY_USER_SELECT = { id: true, appId: true, openid: true, anonOpenid: true, unionid: true, status: true, tokenVersion: true, firstSource: true, firstShareId: true } as const

function bearerToken(req: NextRequest): string | null {
  const header = req.headers.get('authorization')
  if (!header || !header.startsWith('Bearer ')) return null
  return header.slice(7).trim() || null
}

async function readUser(id: string): Promise<DyUserRow | null> {
  const cacheKey = `mp:dyu:${id}`
  const cached = await redis.get(cacheKey).catch(() => null)
  if (cached) {
    try {
      return JSON.parse(cached) as DyUserRow
    } catch {
      // 缓存损坏时回源数据库
    }
  }
  const row = await prisma.dyUser.findUnique({ where: { id }, select: DY_USER_SELECT })
  if (!row) return null
  await redis.set(cacheKey, JSON.stringify(row), 'EX', USER_CACHE_TTL_SEC).catch(() => undefined)
  return row
}

async function touchLastSeen(id: string): Promise<void> {
  try {
    const gate = await redis.set(`mp:dyseen:${id}`, '1', 'EX', 3600, 'NX')
    if (gate === 'OK') await prisma.dyUser.update({ where: { id }, data: { lastSeenAt: new Date() } })
  } catch {
    // 在线状态只是统计口径，失败不影响请求
  }
}

export async function requireDyUser(req: NextRequest): Promise<DyAuth> {
  const token = bearerToken(req)
  if (!token) throw new MpApiError('MP_UNAUTHORIZED')
  const payload = verifyConsumerToken(token, undefined, 'dy')
  if (!payload) throw new MpApiError('MP_UNAUTHORIZED')
  const user = await readUser(payload.sub)
  if (!user) throw new MpApiError('MP_UNAUTHORIZED')
  if (user.tokenVersion !== payload.ver) throw new MpApiError('MP_UNAUTHORIZED')
  if (user.status === 'banned') throw new MpApiError('MP_USER_BANNED')
  // merged 的旧 token 一律失效，客户端会重新登录（N5）。
  if (user.status === 'merged') throw new MpApiError('MP_UNAUTHORIZED')
  void touchLastSeen(user.id)
  return { user, payload }
}

export async function optionalDyUser(req: NextRequest): Promise<DyAuth | null> {
  const token = bearerToken(req)
  if (!token) return null
  const payload = verifyConsumerToken(token, undefined, 'dy')
  if (!payload) return null
  const user = await readUser(payload.sub)
  if (!user || user.status !== 'active' || user.tokenVersion !== payload.ver) return null
  void touchLastSeen(user.id)
  return { user, payload }
}

/** 剩余有效期不足 7 天时随响应下发新 token，客户端看到 X-Mp-Token 就替换本地 token（和微信端同名）。 */
export function withDyTokenHeader(response: NextResponse, auth: DyAuth | null): NextResponse {
  if (auth && tokenNeedsRenewal(auth.payload)) {
    const { token } = signConsumerToken(auth.user.id, auth.user.tokenVersion, undefined, 'dy')
    response.headers.set('X-Mp-Token', token)
  }
  return response
}

/** 所有 dy 路由都要求 X-Dy-App 头（N11）。 */
export function dyAppIdOf(req: NextRequest): string {
  const raw = req.headers.get('x-dy-app')?.trim() ?? ''
  if (!raw || raw.length > 32) throw new MpApiError('MP_VALIDATION', { message: '请求格式无效' })
  return raw
}

export function assertUserApp(user: DyUserRow, appId: string): void {
  if (user.appId !== appId) throw new MpApiError('MP_UNAUTHORIZED')
}