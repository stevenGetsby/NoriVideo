import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { getDyAppSecret } from '@/lib/mp/dy/apps'
import { DY_LOGIN_LIMIT, dyAppIdOf } from '@/lib/mp/dy/auth'
import { dyCode2Session } from '@/lib/mp/dy/session'
import { loginDyUser } from '@/lib/mp/dy/users'
import { MpApiError } from '@/lib/mp/errors'
import { isShareId } from '@/lib/mp/ids'
import { signConsumerToken } from '@/lib/mp/token'
import { checkRateLimit, getClientIp } from '@/lib/rate-limit'

export const runtime = 'nodejs'

function readCode(value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string' || value.length > 256) throw new MpApiError('MP_VALIDATION', { message: '登录凭证无效，请重试' })
  return value.trim() || null
}

export const POST = apiHandler(async (request: NextRequest) => {
  const rate = await checkRateLimit('mp:rl:dylogin', getClientIp(request), DY_LOGIN_LIMIT)
  if (rate.limited) throw new MpApiError('MP_RATE_LIMITED', { retryAfterSeconds: rate.retryAfterSeconds })
  const appId = dyAppIdOf(request)
  const app = await getDyAppSecret(appId)

  const body = await request.json().catch(() => ({})) as { code?: unknown; anonymousCode?: unknown; launch?: unknown }
  const code = readCode(body?.code)
  const anonymousCode = readCode(body?.anonymousCode)
  if (!code && !anonymousCode) throw new MpApiError('MP_VALIDATION', { message: '登录凭证无效，请重试' })

  const launch = body?.launch && typeof body.launch === 'object' ? body.launch as Record<string, unknown> : {}
  const source = typeof launch.source === 'string' && launch.source ? [...launch.source].slice(0, 24).join('') : null
  const shareId = isShareId(launch.s) ? launch.s : null

  const session = await dyCode2Session(app, code, anonymousCode)
  const { user, isNew, merged } = await loginDyUser(app, session, { source, shareId })
  const { token, expiresAt } = signConsumerToken(user.id, user.tokenVersion, undefined, 'dy')
  return NextResponse.json({ token, expiresAt, isNew, merged, loggedIn: user.openid !== null })
})