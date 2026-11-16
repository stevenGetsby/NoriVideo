import { createHash } from 'crypto'
import { MpApiError } from '@/lib/mp/errors'
import { getSignedObjectUrl } from '@/lib/storage'

export const MP_URL_BUCKET_SEC = 6 * 3600
export const MP_URL_TTL_SEC = 12 * 3600

export function cdnConfigured(): boolean {
  return Boolean(process.env.MEDIA_CDN_BASE_URL?.trim() && process.env.MEDIA_CDN_AUTH_KEY?.trim())
}

/** CDN A 型鉴权：ts 按 6 小时分桶，同一桶内 URL 相同，CDN 才能命中缓存。 */
export function signCdnPath(path: string, nowSec: number): string {
  const base = (process.env.MEDIA_CDN_BASE_URL || '').trim().replace(/\/+$/, '')
  const authKey = (process.env.MEDIA_CDN_AUTH_KEY || '').trim()
  const param = process.env.MEDIA_CDN_AUTH_PARAM?.trim() || 'auth_key'
  const ts = Math.floor(nowSec / MP_URL_BUCKET_SEC) * MP_URL_BUCKET_SEC
  const rand = '0'
  const uid = '0'
  const hash = createHash('md5').update(`${path}-${ts}-${rand}-${uid}-${authKey}`).digest('hex')
  return `${base}${path}?${param}=${ts}-${rand}-${uid}-${hash}`
}

export async function mpMediaUrl(key: string, nowSec = Math.floor(Date.now() / 1000)): Promise<string> {
  if (cdnConfigured()) {
    const path = `/${key.split('/').map((segment) => encodeURIComponent(segment)).join('/')}`
    return signCdnPath(path, nowSec)
  }
  if (process.env.MP_ALLOW_TOS_DIRECT === '1') return getSignedObjectUrl(key, MP_URL_TTL_SEC)
  throw new MpApiError('MP_CDN_NOT_CONFIGURED')
}

export function mpUrlExpiresAt(nowSec: number): string {
  const expiresSec = Math.floor(nowSec / MP_URL_BUCKET_SEC) * MP_URL_BUCKET_SEC + MP_URL_TTL_SEC
  return new Date(expiresSec * 1000).toISOString()
}
