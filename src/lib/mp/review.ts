import { ApiError } from '@/lib/api-errors'
import type { StoryIssue, StoryProgram } from '@/lib/interactive/types'
import { prisma } from '@/lib/prisma'
import { getSignedObjectUrl } from '@/lib/storage'
import { describePointer } from './release/media-refs'
import type { ReleaseManifest, ReleaseMeta } from './release/types'

export type ReviewTab = 'pending' | 'done'

export interface ReviewListItem {
  id: string
  version: number
  status: string
  title: string
  creatorName: string
  submitterName: string
  createdAt: string
  totalDurationSec: number
  mediaCount: number
}

export interface ReviewListPayload {
  pendingCount: number
  items: ReviewListItem[]
}

export interface ReviewVideoItem {
  id: string
  sheetUrl: string | null
  playUrl: string | null
  durationSec: number
  where: string[]
}

export interface ReviewImageItem {
  id: string
  url: string | null
  where: string[]
}

export interface ReviewDetailPayload {
  release: {
    id: string
    workId: string
    version: number
    status: string
    note: string | null
    reviewNote: string | null
    failure: string | null
    createdAt: string
    totalDurationSec: number
    chapterCount: number
    endingCount: number
    issues: StoryIssue[]
  }
  meta: ReleaseMeta | null
  submitterName: string
  coverUrl: string | null
  shareCoverUrl: string | null
  trailerUrl: string | null
  trailerPosterUrl: string | null
  videos: ReviewVideoItem[]
  images: ReviewImageItem[]
}

const DONE_STATUSES = ['rejected', 'approved', 'live', 'retired']

export async function listReleasesForReview(tab: ReviewTab): Promise<ReviewListPayload> {
  const [pendingCount, rows] = await Promise.all([
    prisma.storyRelease.count({ where: { status: 'reviewing' } }),
    prisma.storyRelease.findMany({
      where: tab === 'pending' ? { status: 'reviewing' } : { status: { in: DONE_STATUSES } },
      orderBy: tab === 'pending' ? { createdAt: 'asc' } : { reviewedAt: 'desc' },
      select: { id: true, version: true, status: true, meta: true, manifest: true, createdById: true, createdAt: true, totalDurationSec: true },
    }),
  ])
  const users = await prisma.user.findMany({
    where: { id: { in: [...new Set(rows.map((row) => row.createdById))] } },
    select: { id: true, name: true },
  })
  const nameById = new Map(users.map((user) => [user.id, user.name]))
  const items = rows.map((row) => {
    const meta = row.meta as ReleaseMeta | null
    const manifest = row.manifest as ReleaseManifest | null
    return {
      id: row.id,
      version: row.version,
      status: row.status,
      title: meta?.title ?? '',
      creatorName: meta?.creatorName ?? '',
      submitterName: nameById.get(row.createdById) ?? '',
      createdAt: row.createdAt.toISOString(),
      totalDurationSec: row.totalDurationSec,
      mediaCount: Object.keys(manifest?.media ?? {}).length,
    }
  })
  return { pendingCount, items }
}

const sign = (key: string | null | undefined): Promise<string | null> => (key ? getSignedObjectUrl(key) : Promise.resolve(null))

export async function getReleaseForReview(releaseId: string): Promise<ReviewDetailPayload> {
  const row = await prisma.storyRelease.findUnique({ where: { id: releaseId } })
  if (!row) throw new ApiError('NOT_FOUND', { message: '版本不存在。' })
  const meta = row.meta as ReleaseMeta | null
  const manifest = row.manifest as ReleaseManifest | null
  const program = row.program as StoryProgram | null
  const entries = Object.values(manifest?.media ?? {})
  const labelsFor = (refs: string[]) => (program ? refs.map((ref) => describePointer(program, ref)) : refs)

  const [submitter, coverUrl, shareCoverUrl, trailerUrl, trailerPosterUrl, videos, images] = await Promise.all([
    prisma.user.findUnique({ where: { id: row.createdById }, select: { name: true } }),
    sign(meta?.cover),
    sign(meta?.shareCover),
    sign(meta?.trailer),
    sign(meta?.trailerPoster),
    Promise.all(entries.filter((entry) => entry.kind === 'video').map(async (entry) => ({
      id: entry.id,
      sheetUrl: await sign(entry.files.sheet),
      playUrl: await sign(entry.files.v480 ?? entry.files.v720),
      durationSec: entry.durationSec ?? 0,
      where: labelsFor(entry.refs),
    }))),
    Promise.all(entries.filter((entry) => entry.kind === 'image').map(async (entry) => ({
      id: entry.id,
      url: await sign(entry.files.img),
      where: labelsFor(entry.refs),
    }))),
  ])

  return {
    release: {
      id: row.id,
      workId: row.workId,
      version: row.version,
      status: row.status,
      note: row.note,
      reviewNote: row.reviewNote,
      failure: row.failure,
      createdAt: row.createdAt.toISOString(),
      totalDurationSec: row.totalDurationSec,
      chapterCount: row.chapterCount,
      endingCount: row.endingCount,
      issues: (row.issues as StoryIssue[] | null) ?? [],
    },
    meta,
    submitterName: submitter?.name ?? '',
    coverUrl,
    shareCoverUrl,
    trailerUrl,
    trailerPosterUrl,
    videos,
    images,
  }
}
