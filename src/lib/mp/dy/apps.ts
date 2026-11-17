import { prisma } from '@/lib/prisma'
import { redis } from '@/lib/redis'
import { MpApiError } from '../errors'

export interface DyAppRow {
  id: string
  appId: string
  mpWorkId: string
  name: string
  status: string
  releaseIds: string[]
  secretEnc: string
}

/** getDyApp 的缓存安全形状：不含 secretEnc。 */
export type DyAppPublic = Omit<DyAppRow, 'secretEnc'>

const APP_CACHE_SEC = 60
const APP_SELECT = { id: true, appId: true, mpWorkId: true, name: true, status: true, releaseIds: true } as const

function toPublic(row: { id: string; appId: string; mpWorkId: string; name: string; status: string; releaseIds: unknown }): DyAppPublic {
  const releaseIds = Array.isArray(row.releaseIds) ? row.releaseIds.filter((item): item is string => typeof item === 'string') : []
  return { id: row.id, appId: row.appId, mpWorkId: row.mpWorkId, name: row.name, status: row.status, releaseIds }
}

/** 缓存只存不含 secretEnc 的字段（N4）。 */
export async function getDyApp(appId: string): Promise<DyAppPublic> {
  const key = `mp:dyapp:${appId}`
  const cached = await redis.get(key).catch(() => null)
  if (cached) {
    try {
      return JSON.parse(cached) as DyAppPublic
    } catch {
      // 缓存损坏时回源数据库
    }
  }
  const row = await prisma.dyApp.findUnique({ where: { appId }, select: APP_SELECT })
  if (!row || row.status === 'offline') throw new MpApiError('MP_NOT_PLAYABLE')
  const app = toPublic(row)
  await redis.set(key, JSON.stringify(app), 'EX', APP_CACHE_SEC).catch(() => undefined)
  return app
}

export async function getDyAppSecret(appId: string): Promise<DyAppRow> {
  const row = await prisma.dyApp.findUnique({ where: { appId } })
  if (!row || row.status === 'offline') throw new MpApiError('MP_NOT_PLAYABLE')
  return { ...toPublic(row), secretEnc: row.secretEnc }
}

export async function clearDyAppCache(): Promise<void> {
  const keys = await redis.keys('mp:dyapp:*').catch(() => [] as string[])
  if (keys.length) await redis.del(...keys).catch(() => undefined)
}