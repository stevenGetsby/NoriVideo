import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { redis } from '@/lib/redis'
import type { RateLimitConfig } from '@/lib/rate-limit'
import { MpApiError } from './errors'
import { signConsumerToken, tokenNeedsRenewal, verifyConsumerToken, type MpTokenPayload } from './token'

export const MP_LOGIN_LIMIT: RateLimitConfig = { windowSeconds: 60, maxRequests: 20 }
export const MP_ME_PATCH_LIMIT: RateLimitConfig = { windowSeconds: 3600, maxRequests: 10 }

export interface ConsumerRow {
  id: string
  openid: string
  nickname: string
  avatarIndex: number
  status: string
  tokenVersion: number
}

export interface ConsumerAuth {
  consumer: ConsumerRow
  payload: MpTokenPayload
}

const USER_CACHE_TTL_SEC = 60
const USER_SELECT = { id: true, openid: true, nickname: true, avatarIndex: true, status: true, tokenVersion: true } as const

function bearerToken(req: NextRequest): string | null {
  const header = req.headers.get('authorization')
  if (!header || !header.startsWith('Bearer ')) return null
  return header.slice(7).trim() || null
}

async function readConsumer(id: string): Promise<ConsumerRow | null> {
  const cacheKey = `mp:cu:${id}`
  const cached = await redis.get(cacheKey).catch(() => null)
  if (cached) {
    try {
      return JSON.parse(cached) as ConsumerRow
    } catch {
      // 缓存损坏时回源数据库
    }
  }
  const row = await prisma.consumerUser.findUnique({ where: { id }, select: USER_SELECT })
  if (!row) return null
  await redis.set(cacheKey, JSON.stringify(row), 'EX', USER_CACHE_TTL_SEC).catch(() => undefined)
  return row
}

async function touchLastSeen(id: string): Promise<void> {
  try {
    const gate = await redis.set(`mp:seen:${id}`, '1', 'EX', 3600, 'NX')
    if (gate === 'OK') await prisma.consumerUser.update({ where: { id }, data: { lastSeenAt: new Date() } })
  } catch {
    // 在线状态只是统计口径，失败不影响请求
  }
}

export async function optionalConsumer(req: NextRequest): Promise<ConsumerAuth | null> {
  const token = bearerToken(req)
  if (!token) return null
  const payload = verifyConsumerToken(token)
  if (!payload) return null
  const consumer = await readConsumer(payload.sub)
  if (!consumer || consumer.status !== 'active' || consumer.tokenVersion !== payload.ver) return null
  void touchLastSeen(consumer.id)
  return { consumer, payload }
}

export async function requireConsumerAuth(req: NextRequest): Promise<ConsumerAuth> {
  const token = bearerToken(req)
  if (!token) throw new MpApiError('MP_UNAUTHORIZED')
  const payload = verifyConsumerToken(token)
  if (!payload) throw new MpApiError('MP_UNAUTHORIZED')
  const consumer = await readConsumer(payload.sub)
  if (!consumer) throw new MpApiError('MP_UNAUTHORIZED')
  if (consumer.status !== 'active') throw new MpApiError('MP_USER_BANNED')
  if (consumer.tokenVersion !== payload.ver) throw new MpApiError('MP_UNAUTHORIZED')
  void touchLastSeen(consumer.id)
  return { consumer, payload }
}

/** 剩余有效期不足 7 天时随响应下发新 token，客户端看到 X-Mp-Token 就替换本地 token。 */
export function withConsumerTokenHeader(response: NextResponse, auth: ConsumerAuth | null): NextResponse {
  if (auth && tokenNeedsRenewal(auth.payload)) {
    const { token } = signConsumerToken(auth.consumer.id, auth.consumer.tokenVersion)
    response.headers.set('X-Mp-Token', token)
  }
  return response
}
