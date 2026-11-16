import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { MP_ME_PATCH_LIMIT, requireConsumerAuth, withConsumerTokenHeader } from '@/lib/mp/auth'
import { MP_AVATAR_COUNT } from '@/lib/mp/constants'
import { toMpMe } from '@/lib/mp/dto'
import { MpApiError } from '@/lib/mp/errors'
import { msgSecCheck } from '@/lib/mp/wx'
import { prisma } from '@/lib/prisma'
import { checkRateLimit } from '@/lib/rate-limit'
import { redis } from '@/lib/redis'

export const runtime = 'nodejs'

const SAVE_SELECT = { endingsGot: true, profile: true } as const

export const GET = apiHandler(async (request: NextRequest) => {
  const auth = await requireConsumerAuth(request)
  const saves = await prisma.consumerSave.findMany({ where: { consumerId: auth.consumer.id }, select: SAVE_SELECT })
  return withConsumerTokenHeader(NextResponse.json(toMpMe(auth.consumer, saves)), auth)
})

export const PATCH = apiHandler(async (request: NextRequest) => {
  const auth = await requireConsumerAuth(request)
  const rate = await checkRateLimit('mp:rl:me', auth.consumer.id, MP_ME_PATCH_LIMIT)
  if (rate.limited) throw new MpApiError('MP_RATE_LIMITED', { retryAfterSeconds: rate.retryAfterSeconds })

  const body = await request.json().catch(() => ({})) as { nickname?: unknown; avatarIndex?: unknown }
  const data: { nickname?: string; avatarIndex?: number } = {}
  if (body?.nickname !== undefined) {
    const nickname = typeof body.nickname === 'string' ? body.nickname.trim() : ''
    const length = [...nickname].length
    if (length < 2 || length > 16) throw new MpApiError('MP_VALIDATION', { message: '昵称需要 2–16 字' })
    if (!await msgSecCheck(auth.consumer.openid, nickname)) throw new MpApiError('MP_CONTENT_RISKY')
    data.nickname = nickname
  }
  if (body?.avatarIndex !== undefined) {
    const avatarIndex = body.avatarIndex
    if (typeof avatarIndex !== 'number' || !Number.isInteger(avatarIndex) || avatarIndex < 0 || avatarIndex >= MP_AVATAR_COUNT) {
      throw new MpApiError('MP_VALIDATION', { message: '头像不存在' })
    }
    data.avatarIndex = avatarIndex
  }
  if (Object.keys(data).length === 0) throw new MpApiError('MP_VALIDATION', { message: '没有需要保存的修改' })

  const user = await prisma.consumerUser.update({ where: { id: auth.consumer.id }, data, select: { id: true, nickname: true, avatarIndex: true } })
  await redis.del(`mp:cu:${auth.consumer.id}`).catch(() => undefined)
  const saves = await prisma.consumerSave.findMany({ where: { consumerId: auth.consumer.id }, select: SAVE_SELECT })
  return withConsumerTokenHeader(NextResponse.json(toMpMe(user, saves)), auth)
})
