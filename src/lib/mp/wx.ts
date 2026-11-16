import { createScopedLogger } from '@/lib/logging/core'
import { redis } from '@/lib/redis'
import { MpApiError } from './errors'

const logger = createScopedLogger({ module: 'mp-wx' })
const WX_BASE = 'https://api.weixin.qq.com'

function appCredentials(): { appid: string; secret: string } {
  const appid = process.env.MP_APP_ID?.trim()
  const secret = process.env.MP_APP_SECRET?.trim()
  if (!appid || !secret) throw new MpApiError('MP_WX_UNAVAILABLE')
  return { appid, secret }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export interface WxSession {
  openid: string
  unionid: string | null
}

/** 不保存 session_key（R7：C 端不需要解密手机号等能力）。 */
export async function code2Session(code: string): Promise<WxSession> {
  const { appid, secret } = appCredentials()
  const url = `${WX_BASE}/sns/jscode2session?appid=${encodeURIComponent(appid)}&secret=${encodeURIComponent(secret)}&js_code=${encodeURIComponent(code)}&grant_type=authorization_code`
  let data: { openid?: string; unionid?: string; errcode?: number; errmsg?: string }
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) })
    data = await response.json() as typeof data
  } catch {
    throw new MpApiError('MP_WX_UNAVAILABLE')
  }
  if (data.errcode === 40029 || data.errcode === 40163) {
    throw new MpApiError('MP_VALIDATION', { message: '登录凭证无效，请重试' })
  }
  if (data.errcode || !data.openid) {
    logger.warn({ action: 'mp.wx.code2session.failed', message: '微信登录凭证校验失败', details: { errcode: data.errcode ?? null } })
    throw new MpApiError('MP_WX_UNAVAILABLE')
  }
  return { openid: data.openid, unionid: data.unionid ?? null }
}

export async function getAccessToken(force = false): Promise<string> {
  if (!force) {
    const cached = await redis.get('mp:wx:token')
    if (cached) return cached
  }
  const { appid, secret } = appCredentials()
  const locked = await redis.set('mp:wx:token:lock', '1', 'EX', 10, 'NX')
  if (locked !== 'OK') {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await sleep(200)
      const cached = await redis.get('mp:wx:token')
      if (cached) return cached
    }
    throw new MpApiError('MP_WX_UNAVAILABLE')
  }
  try {
    let data: { access_token?: string; expires_in?: number; errcode?: number; errmsg?: string }
    try {
      const response = await fetch(`${WX_BASE}/cgi-bin/stable_token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grant_type: 'client_credential', appid, secret, force_refresh: force }),
        signal: AbortSignal.timeout(8000),
      })
      data = await response.json() as typeof data
    } catch {
      throw new MpApiError('MP_WX_UNAVAILABLE')
    }
    if (!data.access_token || !data.expires_in) {
      logger.warn({ action: 'mp.wx.token.failed', message: '微信 access_token 获取失败', details: { errcode: data.errcode ?? null } })
      throw new MpApiError('MP_WX_UNAVAILABLE')
    }
    await redis.set('mp:wx:token', data.access_token, 'EX', Math.max(60, data.expires_in - 300))
    return data.access_token
  } finally {
    await redis.del('mp:wx:token:lock').catch(() => undefined)
  }
}

/** true = 微信内容安全判定通过。40001/42001 时刷新 token 只重试一次。 */
export async function msgSecCheck(openid: string, content: string): Promise<boolean> {
  const call = async (accessToken: string) => {
    const response = await fetch(`${WX_BASE}/wxa/msg_sec_check?access_token=${encodeURIComponent(accessToken)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, version: 2, scene: 1, openid }),
      signal: AbortSignal.timeout(8000),
    })
    return response.json() as Promise<{ errcode?: number; errmsg?: string; result?: { suggest?: string; label?: number } }>
  }
  let data: Awaited<ReturnType<typeof call>>
  try {
    data = await call(await getAccessToken())
    if (data.errcode === 40001 || data.errcode === 42001) {
      data = await call(await getAccessToken(true))
    }
  } catch (error) {
    if (error instanceof MpApiError) throw error
    throw new MpApiError('MP_WX_UNAVAILABLE')
  }
  if (data.errcode) {
    logger.warn({ action: 'mp.wx.msgsec.failed', message: '微信内容安全检查失败', details: { errcode: data.errcode } })
    throw new MpApiError('MP_WX_UNAVAILABLE')
  }
  return data.result?.suggest === 'pass'
}
