import type { Prisma } from '@prisma/client'
import { ApiError } from '@/lib/api-errors'
import { createScopedLogger } from '@/lib/logging/core'
import { prisma } from '@/lib/prisma'
import { redis } from '@/lib/redis'
import { MpApiError } from '../errors'

const logger = createScopedLogger({ module: 'mp-lifecycle' })

export type MpNotifyKind = 'work_live' | 'chapter_update'

export async function invalidateMpCache(): Promise<void> {
  await redis.incr('mp:cache:ver')
}

export async function enqueueNotify(kind: MpNotifyKind, mpWorkId: string, releaseId: string): Promise<void> {
  await redis.rpush('mp:notify:queue', JSON.stringify({ kind, mpWorkId, releaseId, enqueuedAt: new Date().toISOString() }))
}

interface GoLiveOutcome { mpWorkId: string; firstLive: boolean; chapterUpdate: boolean }

async function goLiveTx(tx: Prisma.TransactionClient, releaseId: string, now: Date): Promise<GoLiveOutcome> {
  const release = await tx.storyRelease.findUnique({ where: { id: releaseId } })
  if (!release) throw new ApiError('NOT_FOUND', { message: '版本不存在。' })
  if (release.status !== 'approved') throw new MpApiError('MP_INVALID_STATE')
  const mpWork = await tx.mpWork.findUnique({ where: { workId: release.workId } })
  if (!mpWork) throw new ApiError('NOT_FOUND', { message: '上架条目不存在。' })
  const oldLive = mpWork.liveReleaseId && mpWork.liveReleaseId !== releaseId
    ? await tx.storyRelease.findUnique({ where: { id: mpWork.liveReleaseId } })
    : null
  if (oldLive) {
    await tx.storyRelease.update({ where: { id: oldLive.id }, data: { status: 'retired', retiredAt: now } })
  }
  await tx.storyRelease.update({ where: { id: releaseId }, data: { status: 'live', liveAt: now } })
  await tx.mpWork.update({
    where: { id: mpWork.id },
    data: { liveReleaseId: releaseId, pendingReleaseId: null, status: 'live', firstLiveAt: mpWork.firstLiveAt ?? now },
  })
  return {
    mpWorkId: mpWork.id,
    firstLive: mpWork.firstLiveAt == null,
    chapterUpdate: oldLive != null && release.chapterCount > oldLive.chapterCount,
  }
}

async function notifyAfterLive(outcome: GoLiveOutcome, releaseId: string): Promise<void> {
  if (outcome.firstLive) await enqueueNotify('work_live', outcome.mpWorkId, releaseId)
  if (outcome.chapterUpdate) await enqueueNotify('chapter_update', outcome.mpWorkId, releaseId)
}

export async function goLive(releaseId: string): Promise<GoLiveOutcome> {
  const outcome = await prisma.$transaction((tx) => goLiveTx(tx, releaseId, new Date()))
  await invalidateMpCache()
  await notifyAfterLive(outcome, releaseId)
  return outcome
}

export async function approveRelease(releaseId: string, adminId: string) {
  const now = new Date()
  const outcome = await prisma.$transaction(async (tx) => {
    const release = await tx.storyRelease.findUnique({ where: { id: releaseId } })
    if (!release) throw new ApiError('NOT_FOUND', { message: '版本不存在。' })
    if (release.status !== 'reviewing') throw new MpApiError('MP_INVALID_STATE')
    await tx.storyRelease.update({ where: { id: releaseId }, data: { status: 'approved', reviewedById: adminId, reviewedAt: now } })
    const mpWork = await tx.mpWork.findUnique({ where: { workId: release.workId } })
    if (!mpWork) throw new ApiError('NOT_FOUND', { message: '上架条目不存在。' })
    if (mpWork.firstLiveAt == null && mpWork.scheduledAt && mpWork.scheduledAt.getTime() > now.getTime()) {
      await tx.mpWork.update({
        where: { id: mpWork.id },
        data: { pendingReleaseId: releaseId, status: mpWork.reservable ? 'scheduled' : 'draft' },
      })
      return { scheduled: true as const, mpWorkId: mpWork.id, firstLive: false, chapterUpdate: false }
    }
    const live = await goLiveTx(tx, releaseId, now)
    return { scheduled: false as const, ...live }
  })
  await invalidateMpCache()
  if (!outcome.scheduled) await notifyAfterLive(outcome, releaseId)
  return outcome
}

export async function rejectRelease(releaseId: string, adminId: string, note: string) {
  const trimmed = note.trim()
  if ([...trimmed].length < 5 || [...trimmed].length > 200) {
    throw new MpApiError('MP_VALIDATION', { message: '驳回原因需要 5–200 字' })
  }
  const now = new Date()
  await prisma.$transaction(async (tx) => {
    const release = await tx.storyRelease.findUnique({ where: { id: releaseId } })
    if (!release) throw new ApiError('NOT_FOUND', { message: '版本不存在。' })
    if (release.status !== 'reviewing') throw new MpApiError('MP_INVALID_STATE')
    await tx.storyRelease.update({ where: { id: releaseId }, data: { status: 'rejected', reviewNote: trimmed, reviewedById: adminId, reviewedAt: now } })
  })
}

export async function offlineWork(mpWorkId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const mpWork = await tx.mpWork.findUnique({ where: { id: mpWorkId } })
    if (!mpWork) throw new ApiError('NOT_FOUND', { message: '上架条目不存在。' })
    if (mpWork.status !== 'live') throw new MpApiError('MP_INVALID_STATE')
    await tx.mpWork.update({ where: { id: mpWorkId }, data: { status: 'offline' } })
  })
  await invalidateMpCache()
}

export async function onlineWork(mpWorkId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const mpWork = await tx.mpWork.findUnique({ where: { id: mpWorkId } })
    if (!mpWork) throw new ApiError('NOT_FOUND', { message: '上架条目不存在。' })
    if (mpWork.status !== 'offline' || !mpWork.liveReleaseId) throw new MpApiError('MP_INVALID_STATE')
    await tx.mpWork.update({ where: { id: mpWorkId }, data: { status: 'live' } })
  })
  await invalidateMpCache()
}

export async function banWork(mpWorkId: string, reason: string, adminId: string): Promise<void> {
  const trimmed = reason.trim()
  if (!trimmed || [...trimmed].length > 200) throw new MpApiError('MP_VALIDATION', { message: '请填写封禁原因（200 字以内）' })
  await prisma.$transaction(async (tx) => {
    const mpWork = await tx.mpWork.findUnique({ where: { id: mpWorkId } })
    if (!mpWork) throw new ApiError('NOT_FOUND', { message: '上架条目不存在。' })
    await tx.mpWork.update({ where: { id: mpWorkId }, data: { status: 'banned', bannedReason: trimmed } })
  })
  logger.info({ action: 'mp.work.banned', message: '作品已封禁', details: { mpWorkId, adminId } })
  await invalidateMpCache()
}

export async function unbanWork(mpWorkId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const mpWork = await tx.mpWork.findUnique({ where: { id: mpWorkId } })
    if (!mpWork) throw new ApiError('NOT_FOUND', { message: '上架条目不存在。' })
    if (mpWork.status !== 'banned') throw new MpApiError('MP_INVALID_STATE')
    await tx.mpWork.update({ where: { id: mpWorkId }, data: { status: 'offline', bannedReason: null } })
  })
  await invalidateMpCache()
}
