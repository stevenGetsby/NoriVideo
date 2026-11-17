import { prisma } from '@/lib/prisma'
import { MP_URL_BUCKET_SEC, MP_URL_TTL_SEC, mpMediaUrl } from '@/lib/storage/cdn'
import { signMediaEntry } from '../catalog'
import type { PlayManifest } from '../dto'
import { MpApiError } from '../errors'
import type { ReleaseManifest, ReleaseMeta } from '../release/types'
import { getDyApp } from './apps'

export type SignedMedia = PlayManifest['media'][string]

export interface DyPlayManifest {
  releaseId: string
  version: number
  aspectRatio: string
  programUrl: string
  programHash: string
  media: Record<string, SignedMedia>
  expiresAt: number
  stats: string | null
  meta: {
    title: string
    chapters: ReleaseMeta['chapters']
    endings: ReleaseMeta['endings']
    achievements: ReleaseMeta['achievements']
  }
}

const PLAYABLE_STATUS = new Set(['approved', 'live', 'retired'])

// 将来给 release 加 GC 时，必须跳过所有 dy_apps.releaseIds 里的 release（R5）。
// 不调用 ensureSave，不增加 playerCount（N7）：抖音端玩家口径走 dy_events。
export async function dyPlayManifest(appId: string, releaseId: string): Promise<DyPlayManifest> {
  const app = await getDyApp(appId)
  if (!app.releaseIds.includes(releaseId)) throw new MpApiError('MP_NOT_PLAYABLE')
  const release = await prisma.storyRelease.findUnique({
    where: { id: releaseId },
    select: { id: true, workId: true, version: true, aspectRatio: true, status: true, programKey: true, programHash: true, manifest: true, meta: true },
  })
  const manifest = release?.manifest as unknown as ReleaseManifest | null | undefined
  const meta = release?.meta as unknown as ReleaseMeta | null | undefined
  // 失败一律 MP_NOT_PLAYABLE，不泄露具体原因。
  if (!release || !PLAYABLE_STATUS.has(release.status) || !release.programKey || !release.programHash || !manifest || !meta) {
    throw new MpApiError('MP_NOT_PLAYABLE')
  }
  const work = await prisma.mpWork.findUnique({ where: { id: app.mpWorkId }, select: { id: true, workId: true, status: true } })
  if (!work || work.workId !== release.workId || work.status === 'banned') throw new MpApiError('MP_NOT_PLAYABLE')

  const nowSec = Math.floor(Date.now() / 1000)
  const entries = await Promise.all(Object.entries(manifest.media).map(async ([id, entry]) => [id, await signMediaEntry(entry, nowSec)] as const))
  const achievements = await Promise.all(meta.achievements.map(async (achievement) => ({
    ...achievement,
    icon: achievement.icon?.startsWith('mp/releases/') ? await mpMediaUrl(achievement.icon, nowSec) : achievement.icon,
  })))
  return {
    releaseId: release.id,
    version: release.version,
    aspectRatio: release.aspectRatio,
    programUrl: await mpMediaUrl(release.programKey, nowSec),
    programHash: release.programHash,
    media: Object.fromEntries(entries),
    // epoch 秒，与 mpUrlExpiresAt 同一口径（6h 分桶 + 12h TTL）。
    expiresAt: Math.floor(nowSec / MP_URL_BUCKET_SEC) * MP_URL_BUCKET_SEC + MP_URL_TTL_SEC,
    stats: `/api/mp/releases/${release.id}/stats`,
    meta: { title: meta.title, chapters: meta.chapters, endings: meta.endings, achievements },
  }
}