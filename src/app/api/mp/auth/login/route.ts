import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { resolveFirstTouch, resolveLaunch } from '@/lib/mp/attribution'
import { MP_LOGIN_LIMIT } from '@/lib/mp/auth'
import { toMpMe } from '@/lib/mp/dto'
import { MpApiError } from '@/lib/mp/errors'
import { defaultNickname } from '@/lib/mp/ids'
import { signConsumerToken } from '@/lib/mp/token'
import { code2Session } from '@/lib/mp/wx'
import { prisma } from '@/lib/prisma'
import { checkRateLimit, getClientIp } from '@/lib/rate-limit'

export const runtime = 'nodejs'

export const POST = apiHandler(async (request: NextRequest) => {
  const rate = await checkRateLimit('mp:rl:login', getClientIp(request), MP_LOGIN_LIMIT)
  if (rate.limited) throw new MpApiError('MP_RATE_LIMITED', { retryAfterSeconds: rate.retryAfterSeconds })

  const body = await request.json().catch(() => ({})) as { code?: unknown; launch?: unknown }
  const code = typeof body?.code === 'string' ? body.code.trim() : ''
  if (!code || code.length > 256) throw new MpApiError('MP_VALIDATION', { message: '登录凭证无效，请重试' })

  const { openid, unionid } = await code2Session(code)
  const attr = resolveLaunch(body?.launch)

  let user = await prisma.consumerUser.findUnique({ where: { openid } })
  let isNew = false
  if (!user) {
    const first = await resolveFirstTouch(attr)
    try {
      user = await prisma.consumerUser.create({ data: { openid, unionid, nickname: defaultNickname(openid), firstSource: attr.source, ...first } })
      isNew = true
    } catch {
      user = await prisma.consumerUser.findUnique({ where: { openid } })
    }
  } else if (unionid && !user.unionid) {
    user = await prisma.consumerUser.update({ where: { id: user.id }, data: { unionid } })
  }
  if (!user) throw new MpApiError('MP_WX_UNAVAILABLE')
  if (user.status !== 'active') throw new MpApiError('MP_USER_BANNED')

  const { token, expiresAt } = signConsumerToken(user.id, user.tokenVersion)
  const saves = await prisma.consumerSave.findMany({ where: { consumerId: user.id }, select: { endingsGot: true, profile: true } })
  return NextResponse.json({ token, expiresAt, user: toMpMe(user, saves), isNew })
})
