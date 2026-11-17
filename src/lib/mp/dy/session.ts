import { decryptApiKey } from '@/lib/crypto-utils'
import { createScopedLogger } from '@/lib/logging/core'
import { MpApiError } from '../errors'
import type { DyAppRow } from './apps'

const logger = createScopedLogger({ module: 'mp-dy-session' })
const DY_BASE = 'https://minigame.zijieapi.com'

export interface DySession {
  openid: string | null
  anonOpenid: string | null
  unionid: string | null
}

/** 不保存 session_key；日志只记 {appId, errcode}，永远不记录 URL 和 secret（N3）。 */
export async function dyCode2Session(app: DyAppRow, code: string | null, anonymousCode: string | null): Promise<DySession> {
  // app 来自 getDyAppSecret（不走缓存），secretEnc 必然在场。
  const secret = decryptApiKey(app.secretEnc)
  const params = new URLSearchParams({ appid: app.appId, secret })
  if (code) params.set('code', code)
  if (anonymousCode) params.set('anonymous_code', anonymousCode)
  let data: { error?: number; errcode?: number; openid?: string; anonymous_openid?: string; unionid?: string }
  try {
    const response = await fetch(`${DY_BASE}/mgplatform/api/apps/jscode2session?${params.toString()}`, { signal: AbortSignal.timeout(5000) })
    data = await response.json() as typeof data
  } catch {
    throw new MpApiError('MP_DY_UNAVAILABLE')
  }
  const errcode = typeof data.errcode === 'number' && data.errcode !== 0
    ? data.errcode
    : typeof data.error === 'number' ? data.error : 0
  if (errcode !== 0) {
    logger.warn({ action: 'mp.dy.code2session.failed', message: '抖音登录凭证校验失败', details: { appId: app.appId, errcode } })
    if (errcode === 40018 || errcode === 40019) throw new MpApiError('MP_VALIDATION', { message: '登录凭证无效，请重试' })
    throw new MpApiError('MP_DY_UNAVAILABLE')
  }
  const openid = typeof data.openid === 'string' && data.openid ? data.openid : null
  const anonOpenid = typeof data.anonymous_openid === 'string' && data.anonymous_openid ? data.anonymous_openid : null
  if (!openid && !anonOpenid) throw new MpApiError('MP_VALIDATION')
  return { openid, anonOpenid, unionid: typeof data.unionid === 'string' && data.unionid ? data.unionid : null }
}