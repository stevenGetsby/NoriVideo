import bcrypt from 'bcryptjs'
import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { getAuthSession, unauthorized } from '@/lib/api-auth'
import { logInfo } from '@/lib/logging/core'
import { prisma } from '@/lib/prisma'
import { AUTH_LOGIN_LIMIT, checkRateLimit, getClientIp } from '@/lib/rate-limit'

export const POST = apiHandler(async (request: NextRequest) => {
  const rate = await checkRateLimit('auth:change-password', getClientIp(request), AUTH_LOGIN_LIMIT)
  if (rate.limited) {
    throw new ApiError('RATE_LIMIT', { message: '尝试次数过多，请稍后再试。' })
  }

  const session = await getAuthSession()
  const actorId = session?.user?.actorId || session?.user?.id
  if (!actorId || session?.user?.status === 'revoked') return unauthorized('登录已失效，请重新登录。')

  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : ''
  const newPassword = typeof body.newPassword === 'string' ? body.newPassword : ''
  const confirmPassword = typeof body.confirmPassword === 'string' ? body.confirmPassword : ''
  if (!currentPassword) throw new ApiError('INVALID_PARAMS', { message: '请输入当前初始密码。' })
  if (newPassword.length < 8 || newPassword.length > 128) {
    throw new ApiError('INVALID_PARAMS', { message: '新密码长度需为 8–128 个字符。' })
  }
  if (newPassword !== confirmPassword) {
    throw new ApiError('INVALID_PARAMS', { message: '两次输入的新密码不一致。' })
  }
  if (newPassword === currentPassword) {
    throw new ApiError('INVALID_PARAMS', { message: '新密码不能与初始密码相同。' })
  }

  const user = await prisma.user.findUnique({
    where: { id: actorId },
    select: {
      id: true,
      password: true,
      status: true,
      sessionVersion: true,
      passwordChangeRequired: true,
      parentAccount: { select: { status: true } },
    },
  })
  if (!user) return unauthorized('登录已失效，请重新登录。')
  if (session.user.status === 'disabled' || user.status !== 'active' || user.parentAccount?.status === 'disabled') {
    throw new ApiError('FORBIDDEN', { message: '账号已停用，请联系管理员。' })
  }
  if (typeof session.user.sessionVersion === 'number' && session.user.sessionVersion !== user.sessionVersion) {
    return unauthorized('密码已重置或登录已失效，请重新登录。')
  }
  if (!user.passwordChangeRequired) {
    throw new ApiError('CONFLICT', { message: '当前账号无需修改初始密码，请返回工作台。' })
  }
  if (!user.password || !await bcrypt.compare(currentPassword, user.password)) {
    throw new ApiError('UNAUTHORIZED', { message: '当前初始密码不正确。' })
  }

  const passwordHash = await bcrypt.hash(newPassword, 12)
  const updated = await prisma.user.updateMany({
    where: {
      id: user.id,
      sessionVersion: user.sessionVersion,
      passwordChangeRequired: true,
    },
    data: { password: passwordHash, passwordChangeRequired: false },
  })
  if (updated.count !== 1) {
    throw new ApiError('CONFLICT', { message: '账号状态已变化，请重新登录后再试。' })
  }
  await prisma.session.deleteMany({ where: { userId: user.id } })
  logInfo('[Auth] 初始密码已修改', { userId: user.id })

  return NextResponse.json({ success: true }, {
    headers: { 'Cache-Control': 'private, no-store, max-age=0' },
  })
})
