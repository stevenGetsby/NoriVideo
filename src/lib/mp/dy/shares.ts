import { prisma } from '@/lib/prisma'
import { MpApiError } from '../errors'
import { isShareId } from '../ids'
import type { DyUserRow } from './auth'

const KINDS = new Set(['work', 'ending', 'video'])

export async function registerDyShare(user: DyUserRow, body: unknown): Promise<{ id: string }> {
  const raw = body && typeof body === 'object' ? body as Record<string, unknown> : {}
  const id = raw.id
  if (!isShareId(id)) throw new MpApiError('MP_VALIDATION', { message: '分享 id 无效' })
  const kind = typeof raw.kind === 'string' && KINDS.has(raw.kind) ? raw.kind : ''
  if (!kind) throw new MpApiError('MP_VALIDATION', { message: '分享类型无效' })
  const endingNodeId = typeof raw.endingNodeId === 'string' && raw.endingNodeId ? [...raw.endingNodeId].slice(0, 64).join('') : null
  // 按 id 幂等：重复注册保留首次的归属，不覆盖。
  await prisma.dyShare.upsert({ where: { id }, create: { id, userId: user.id, appId: user.appId, kind, endingNodeId }, update: {} })
  return { id }
}