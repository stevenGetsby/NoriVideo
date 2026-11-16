import type { AuthSession } from '@/lib/api-auth'
import { ApiError } from '@/lib/api-errors'
import type { Locale } from '@/i18n/routing'
import { requireInteractiveStoryAccess } from '@/lib/interactive/service'
import type { StoryIssue } from '@/lib/interactive/types'
import { prisma } from '@/lib/prisma'
import { submitTask } from '@/lib/task/submitter'
import { TASK_TYPE } from '@/lib/task/types'
import { MpApiError } from './errors'
import { readListing, type MpWorkDraft } from './listing'
import { preflightRelease, type PreflightResult } from './release/preflight'
import { MP_PIPELINE_VERSION } from './release/types'

export interface ReleaseRow {
  id: string
  version: number
  status: string
  progress: number
  failure: string | null
  issues: StoryIssue[] | null
  note: string | null
  reviewNote: string | null
  totalDurationSec: number
  createdAt: string
  liveAt: string | null
  scheduledAt: string | null
}

export interface PublishOverview {
  listing: MpWorkDraft | null
  releases: ReleaseRow[]
  preflight: PreflightResult
  chapters: Array<{ projectId: string; title: string }>
}

export async function requirePublishAccess(session: AuthSession, workId: string) {
  const access = await requireInteractiveStoryAccess(session, workId)
  if (!access.canManage) throw new ApiError('FORBIDDEN', { message: '当前账号没有管理该项目的权限。' })
  return access
}

function releaseIdOfPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const releaseId = (payload as { releaseId?: unknown }).releaseId
  return typeof releaseId === 'string' && releaseId ? releaseId : null
}

export async function getPublishOverview(workId: string): Promise<PublishOverview> {
  const [listing, rows, preflight, chapters, schedule] = await Promise.all([
    readListing(workId),
    prisma.storyRelease.findMany({ where: { workId }, orderBy: { version: 'desc' } }),
    preflightRelease(workId),
    prisma.project.findMany({ where: { workId, deletedAt: null }, select: { id: true, name: true }, orderBy: { createdAt: 'asc' } }),
    prisma.mpWork.findUnique({ where: { workId }, select: { scheduledAt: true, pendingReleaseId: true } }),
  ])
  const releases: ReleaseRow[] = rows.map((row) => ({
    id: row.id,
    version: row.version,
    status: row.status,
    progress: row.progress,
    failure: row.failure,
    issues: Array.isArray(row.issues) ? (row.issues as unknown as StoryIssue[]) : null,
    note: row.note,
    reviewNote: row.reviewNote,
    totalDurationSec: row.totalDurationSec,
    createdAt: row.createdAt.toISOString(),
    liveAt: row.liveAt?.toISOString() ?? null,
    scheduledAt: row.status === 'approved' && schedule?.pendingReleaseId === row.id
      ? schedule.scheduledAt?.toISOString() ?? null
      : null,
  }))
  return { listing, releases, preflight, chapters: chapters.map((chapter) => ({ projectId: chapter.id, title: chapter.name })) }
}

export async function createRelease(params: {
  session: AuthSession
  workId: string
  note: string
  idempotencyKey: string
  locale: Locale
  requestId?: string
}): Promise<{ releaseId: string; taskId: string }> {
  const { session, workId, note, idempotencyKey, locale, requestId } = params
  if ([...note].length > 200) throw new MpApiError('MP_VALIDATION', { message: '版本说明需要 200 字以内' })

  const dedupeKey = `story-release:${workId}:${idempotencyKey}`
  const existingTask = await prisma.task.findFirst({ where: { dedupeKey }, orderBy: { createdAt: 'desc' } })
  const existingReleaseId = releaseIdOfPayload(existingTask?.payload)
  if (existingTask && existingReleaseId) return { releaseId: existingReleaseId, taskId: existingTask.id }

  const inProgress = await prisma.storyRelease.findFirst({
    where: { workId, status: { in: ['building', 'reviewing'] } },
    select: { id: true },
  })
  if (inProgress) throw new MpApiError('MP_RELEASE_IN_PROGRESS')

  const preflight = await preflightRelease(workId)
  if (preflight.errors > 0) {
    throw new MpApiError('MP_PREFLIGHT_FAILED', { issues: preflight.issues, errors: preflight.errors, warnings: preflight.warnings })
  }

  const [story, aggregate, firstProject] = await Promise.all([
    prisma.interactiveStory.findUnique({ where: { workId }, select: { aspectRatio: true } }),
    prisma.storyRelease.aggregate({ where: { workId }, _max: { version: true } }),
    prisma.project.findFirst({ where: { workId, deletedAt: null }, orderBy: { createdAt: 'asc' }, select: { id: true } }),
  ])
  if (!story || !firstProject) throw new ApiError('NOT_FOUND', { message: '影游项目不存在。' })

  const release = await prisma.storyRelease.create({
    data: {
      workId,
      version: (aggregate._max.version ?? 0) + 1,
      status: 'building',
      pipelineVersion: MP_PIPELINE_VERSION,
      aspectRatio: story.aspectRatio,
      note: note || null,
      createdById: session.user.id,
    },
  })
  const submitted = await submitTask({
    userId: session.user.id,
    locale,
    requestId,
    projectId: firstProject.id,
    type: TASK_TYPE.STORY_RELEASE_BUILD,
    targetType: 'work',
    targetId: workId,
    payload: { releaseId: release.id },
    dedupeKey,
  })
  if (submitted.deduped) {
    // A concurrent request with the same key won the race; this row has no artifacts yet (R2).
    await prisma.storyRelease.deleteMany({ where: { id: release.id, status: 'building', taskId: null } })
    const task = await prisma.task.findUnique({ where: { id: submitted.taskId }, select: { payload: true } })
    const releaseId = releaseIdOfPayload(task?.payload)
    if (!releaseId) throw new ApiError('INTERNAL_ERROR', { message: '版本任务创建后无法读取。' })
    return { releaseId, taskId: submitted.taskId }
  }
  await prisma.storyRelease.update({ where: { id: release.id }, data: { taskId: submitted.taskId } })
  return { releaseId: release.id, taskId: submitted.taskId }
}
