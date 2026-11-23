/**
 * 算力账本路由共用：管理员/成员上下文构建、上海日参数解析、no-store 头。
 * 鉴权调用（requireAdminAuth/requireUserAuth）内联在各路由里，路由契约守卫据此校验；
 * 这里只做角色归一化与上下文构建：管理员路由仅 role==='admin'（超管拒绝）；成员路由超管拒绝，
 * 其余放行，对象级权限在服务层校验。角色不符抛 ApiError(FORBIDDEN)，由 apiHandler 转 403。
 */
import { NextResponse } from 'next/server'
import { ApiError } from '@/lib/api-errors'
import type { AuthSession } from '@/lib/api-auth'
import { normalizeAccountRole } from '@/lib/account/permissions'
import { daysBetweenKeys, isValidDateKey } from './calc'

export const NO_STORE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  Pragma: 'no-cache',
} as const

export type LedgerCtx = { ownerId: string; actorId: string; isAdmin: boolean }

export function adminLedgerCtx(session: AuthSession): { ctx: LedgerCtx } {
  if (normalizeAccountRole(session.user.role) !== 'admin') {
    throw new ApiError('FORBIDDEN', { message: '仅管理员可以查看算力账本。' })
  }
  return {
    ctx: {
      ownerId: session.user.id,
      actorId: session.user.actorId ?? session.user.id,
      isAdmin: true,
    },
  }
}

export function memberLedgerCtx(session: AuthSession): { ctx: LedgerCtx } {
  const role = normalizeAccountRole(session.user.role)
  if (role === 'super_admin') {
    throw new ApiError('FORBIDDEN', { message: '平台超管不属于任何团队工作区，无法使用算力账本。' })
  }
  return {
    ctx: {
      ownerId: session.user.workspaceOwnerId ?? session.user.id,
      actorId: session.user.actorId ?? session.user.id,
      isAdmin: role === 'admin',
    },
  }
}

export function parseDateKeyParam(value: string | null, name: string): string | null {
  if (value == null || value === '') return null
  if (!isValidDateKey(value)) {
    throw new ApiError('INVALID_PARAMS', { message: `${name} 必须是 YYYY-MM-DD 格式的真实日期。` })
  }
  return value
}

export function parseDateRange(
  params: URLSearchParams,
  options: { maxDays?: number } = {},
): { from: string | null; to: string | null } {
  const from = parseDateKeyParam(params.get('from'), 'from')
  const to = parseDateKeyParam(params.get('to'), 'to')
  if (from && to && from > to) {
    throw new ApiError('INVALID_PARAMS', { message: 'from 不能晚于 to。' })
  }
  if (from && to && options.maxDays && daysBetweenKeys(from, to) + 1 > options.maxDays) {
    throw new ApiError('INVALID_PARAMS', { message: `查询区间不能超过 ${options.maxDays} 天。` })
  }
  return { from, to }
}

export function json(payload: unknown): NextResponse {
  return NextResponse.json(payload, { headers: NO_STORE_HEADERS })
}

export function csvResponse(filename: string, content: string): NextResponse {
  return new NextResponse(content, {
    headers: {
      ...NO_STORE_HEADERS,
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}