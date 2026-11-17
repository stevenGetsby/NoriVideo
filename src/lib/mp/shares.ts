import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { mpMediaUrl } from '@/lib/storage/cdn'
import { getObjectBuffer, uploadObject } from '@/lib/storage'
import { workBySlug } from './catalog'
import { MpApiError } from './errors'
import { getUnlimitedWxacode } from './wx'

export const MP_SHARE_LIMIT = { windowSeconds: 60, maxRequests: 30 }
export const MP_WXACODE_LIMIT = { windowSeconds: 60, maxRequests: 20 }

const SHARE_ID_PATTERN = /^[0-9A-Za-z]{10}$/
const SHARE_KINDS = ['work', 'ending', 'timeline', 'poster'] as const

function isP2002(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

function readShareId(value: unknown): string {
  const id = typeof value === 'string' ? value.trim() : ''
  if (!SHARE_ID_PATTERN.test(id)) throw new MpApiError('MP_VALIDATION', { message: '分享标识无效' })
  return id
}

export async function registerShare(consumerId: string, body: { id?: unknown; slug?: unknown; kind?: unknown; endingNodeId?: unknown }): Promise<{ ok: true }> {
  const id = readShareId(body.id)
  const kind = body.kind
  if (!SHARE_KINDS.includes(kind as (typeof SHARE_KINDS)[number])) throw new MpApiError('MP_VALIDATION', { message: '分享类型无效' })
  const slug = typeof body.slug === 'string' ? body.slug.trim() : ''
  const work = await workBySlug(slug)
  const endingNodeId = typeof body.endingNodeId === 'string' && body.endingNodeId.trim() ? body.endingNodeId.trim().slice(0, 64) : null

  const existing = await prisma.mpShare.findUnique({ where: { id }, select: { consumerId: true } })
  if (existing) {
    if (existing.consumerId !== consumerId) throw new MpApiError('MP_INVALID_STATE', { message: '分享标识已被占用' })
    return { ok: true }
  }
  try {
    await prisma.mpShare.create({ data: { id, consumerId, mpWorkId: work.id, kind: kind as string, endingNodeId } })
  } catch (error) {
    if (!isP2002(error)) throw error
    const row = await prisma.mpShare.findUnique({ where: { id }, select: { consumerId: true } })
    if (row && row.consumerId !== consumerId) throw new MpApiError('MP_INVALID_STATE', { message: '分享标识已被占用' })
  }
  return { ok: true }
}

export async function shareWxacode(consumerId: string, shareId: unknown): Promise<{ url: string }> {
  const id = readShareId(shareId)
  const share = await prisma.mpShare.findUnique({ where: { id }, select: { consumerId: true, mpWorkId: true } })
  if (!share || share.consumerId !== consumerId) throw new MpApiError('MP_VALIDATION', { message: '分享不存在' })
  const key = `mp/wxacode/s/${id}.png`
  let exists = true
  try {
    await getObjectBuffer(key)
  } catch {
    exists = false
  }
  if (!exists) {
    const work = await prisma.mpWork.findUnique({ where: { id: share.mpWorkId }, select: { slug: true } })
    if (!work) throw new MpApiError('MP_WORK_NOT_FOUND')
    // scene 带上 w，落地页无需额外接口即可定位作品（E.3 没有 share 反查路由）。
    const buffer = await getUnlimitedWxacode(`s=${id}&w=${work.slug}`, 'pages/work/index')
    await uploadObject(buffer, key, undefined, 'image/png')
  }
  return { url: await mpMediaUrl(key) }
}
