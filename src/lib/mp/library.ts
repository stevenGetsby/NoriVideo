import { Prisma } from '@prisma/client'
import { emptyProfile } from '@/lib/interactive/achievements'
import { emptySaves } from '@/lib/interactive/saves'
import { prisma } from '@/lib/prisma'
import { workBySlug } from './catalog'
import { MP_RATING_PRIOR_M } from './constants'
import { MpApiError } from './errors'
import { mergeSaveState, normalizeSaveState, type SaveState } from './save-merge'

export const MP_SAVE_LIMIT = { windowSeconds: 60, maxRequests: 30 }
export const MP_REPORT_LIMIT = { windowSeconds: 86400, maxRequests: 10 }

const REPORT_REASONS = ['vulgar', 'violence', 'politics', 'copyright', 'minor', 'other'] as const

const toJson = (value: unknown) => value as unknown as Prisma.InputJsonValue

function isP2002(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

// 首次写入撞上并发创建（P2002）时重试一次，此时行已存在，走合并/更新分支。
async function withCreateRetry<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    if (isP2002(error)) return run()
    throw error
  }
}

export interface SavePutBody {
  baseRev?: unknown
  releaseId?: unknown
  profile?: unknown
  saves?: unknown
  permanent?: unknown
  progress?: unknown
  endingsGot?: unknown
}

function readProgress(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0
}

function readEndingsGot(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0
}

export async function getSave(slug: string, consumerId: string) {
  const work = await workBySlug(slug)
  const row = await prisma.consumerSave.findUnique({ where: { consumerId_mpWorkId: { consumerId, mpWorkId: work.id } } })
  if (!row) return { rev: 0, releaseId: null, profile: emptyProfile(), saves: emptySaves(), permanent: {} }
  return { rev: row.rev, releaseId: row.releaseId, profile: row.profile, saves: row.saves, permanent: row.permanent }
}

export async function putSave(slug: string, consumerId: string, body: SavePutBody): Promise<SaveState & { rev: number; merged: boolean }> {
  const baseRev = body.baseRev
  if (typeof baseRev !== 'number' || !Number.isInteger(baseRev) || baseRev < 0) throw new MpApiError('MP_VALIDATION', { message: '存档版本无效' })
  const releaseId = typeof body.releaseId === 'string' ? body.releaseId.trim() : ''
  if (!releaseId) throw new MpApiError('MP_VALIDATION', { message: '缺少版本信息' })
  const work = await workBySlug(slug)
  const client = normalizeSaveState(body)
  const progress = readProgress(body.progress)
  const endingsGot = readEndingsGot(body.endingsGot)
  const where = { consumerId_mpWorkId: { consumerId, mpWorkId: work.id } }

  const outcome = await withCreateRetry(() => prisma.$transaction(async (tx) => {
    const row = await tx.consumerSave.findUnique({ where })
    if (!row) {
      await tx.consumerSave.create({
        data: { consumerId, mpWorkId: work.id, releaseId, profile: toJson(client.profile), saves: toJson(client.saves), permanent: toJson(client.permanent), rev: 1, progress, endingsGot },
      })
      await tx.mpWork.update({ where: { id: work.id }, data: { playerCount: { increment: 1 } } })
      return { rev: 1, state: client, merged: false }
    }
    const merged = baseRev !== row.rev
    const state = merged ? mergeSaveState(row, body) : client
    const rev = row.rev + 1
    await tx.consumerSave.update({
      where: { id: row.id },
      data: { releaseId, profile: toJson(state.profile), saves: toJson(state.saves), permanent: toJson(state.permanent), rev, progress, endingsGot, lastPlayedAt: new Date() },
    })
    return { rev, state, merged }
  }))

  return { rev: outcome.rev, profile: outcome.state.profile, saves: outcome.state.saves, permanent: outcome.state.permanent, merged: outcome.merged }
}

export async function setFavorite(slug: string, consumerId: string, favorited: boolean): Promise<{ favorited: boolean }> {
  const work = await workBySlug(slug)
  const where = { consumerId_mpWorkId: { consumerId, mpWorkId: work.id } }
  const existing = await prisma.consumerFavorite.findUnique({ where, select: { id: true } })
  if (favorited && !existing) {
    try {
      await prisma.$transaction([
        prisma.consumerFavorite.create({ data: { consumerId, mpWorkId: work.id } }),
        prisma.mpWork.update({ where: { id: work.id }, data: { favoriteCount: { increment: 1 } } }),
      ])
    } catch (error) {
      if (!isP2002(error)) throw error
    }
  } else if (!favorited && existing) {
    await prisma.$transaction([
      prisma.consumerFavorite.delete({ where: { id: existing.id } }),
      prisma.mpWork.update({ where: { id: work.id }, data: { favoriteCount: { decrement: 1 } } }),
    ])
  }
  return { favorited }
}

export async function setRating(slug: string, consumerId: string, score: unknown): Promise<{ score: number }> {
  if (typeof score !== 'number' || !Number.isInteger(score) || score < 1 || score > 5) throw new MpApiError('MP_VALIDATION', { message: '评分需要 1–5 分' })
  const validScore = score
  const work = await workBySlug(slug)
  const where = { consumerId_mpWorkId: { consumerId, mpWorkId: work.id } }

  await withCreateRetry(() => prisma.$transaction(async (tx) => {
    const existing = await tx.consumerRating.findUnique({ where })
    if (!existing) {
      await tx.consumerRating.create({ data: { consumerId, mpWorkId: work.id, score: validScore } })
      await tx.mpWork.update({ where: { id: work.id }, data: { ratingCount: { increment: 1 }, ratingSum: { increment: validScore } } })
    } else {
      await tx.consumerRating.update({ where: { id: existing.id }, data: { score: validScore } })
      await tx.mpWork.update({ where: { id: work.id }, data: { ratingSum: { increment: validScore - existing.score } } })
    }
    const totals = await tx.mpWork.findUnique({ where: { id: work.id }, select: { ratingCount: true, ratingSum: true } })
    const site = await tx.mpWork.aggregate({ _sum: { ratingCount: true, ratingSum: true } })
    const siteCount = site._sum.ratingCount ?? 0
    const priorMean = siteCount > 0 ? (site._sum.ratingSum ?? 0) / siteCount : 4.0
    const count = totals?.ratingCount ?? 0
    const mean = count > 0 ? (totals?.ratingSum ?? 0) / count : 0
    const m = MP_RATING_PRIOR_M
    const ratingScore = (count / (count + m)) * mean + (m / (count + m)) * priorMean
    await tx.mpWork.update({ where: { id: work.id }, data: { ratingScore } })
  }))

  return { score: validScore }
}

export async function createReport(slug: string, consumerId: string, reason: unknown, detail: unknown): Promise<{ ok: true }> {
  if (typeof reason !== 'string' || !REPORT_REASONS.includes(reason as (typeof REPORT_REASONS)[number])) {
    throw new MpApiError('MP_VALIDATION', { message: '请选择举报原因' })
  }
  const text = typeof detail === 'string' ? detail.trim() : ''
  if ([...text].length > 200) throw new MpApiError('MP_VALIDATION', { message: '举报说明最多 200 字' })
  const work = await workBySlug(slug)
  await prisma.mpReport.create({ data: { consumerId, mpWorkId: work.id, reason, detail: text } })
  return { ok: true }
}
