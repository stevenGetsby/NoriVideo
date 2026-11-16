import { buildStoryProgram } from '@/features/interactive/story-overview-model'
import { loadStoryForRelease } from '@/lib/interactive/service'
import type { StoryAspectRatio, StoryIssue, StoryProgram, StoryResolution } from '@/lib/interactive/types'
import { countIssues, sortIssues, validateStory } from '@/lib/interactive/validate'
import { prisma } from '@/lib/prisma'
import { validateListing, type ListingValue } from '../listing'
import { collectMediaRefs } from './media-refs'

export interface PreflightResult {
  issues: StoryIssue[]
  errors: number
  warnings: number
}

export type ReleaseStoryData = Awaited<ReturnType<typeof loadStoryForRelease>>

export function programForRelease(data: ReleaseStoryData): StoryProgram {
  return buildStoryProgram({
    story: {
      ...data.story,
      aspectRatio: data.story.aspectRatio as StoryAspectRatio,
      resolution: data.story.resolution as StoryResolution,
      canManage: true,
      canCreateChapters: true,
    },
    chapters: data.chapters,
  })
}

const issue = (level: StoryIssue['level'], code: string, message: string, projectId: string | null = null, nodeId: string | null = null): StoryIssue =>
  ({ level, code, message, projectId, nodeId })

const LISTING_FIELDS = ['title', 'tagline', 'synopsis', 'tags', 'creatorName'] as const

export async function preflightRelease(workId: string): Promise<PreflightResult> {
  const data = await loadStoryForRelease(workId)
  const program = programForRelease(data)
  const issues: StoryIssue[] = validateStory(program)

  const listing = await prisma.mpWork.findUnique({ where: { workId } })
  const listingValue: ListingValue = {
    title: listing?.title ?? '',
    tagline: listing?.tagline ?? '',
    synopsis: listing?.synopsis ?? '',
    tags: Array.isArray(listing?.tags) ? (listing.tags as unknown[]).filter((tag): tag is string => typeof tag === 'string') : [],
    creatorName: listing?.creatorName ?? '',
    coverKey: null,
    shareCoverKey: null,
    trailerEnabled: true,
    reservable: true,
    scheduleMode: 'now',
    scheduledAt: null,
  }
  const listingFields = validateListing(listingValue)
  for (const field of LISTING_FIELDS) {
    if (listingFields[field]) issues.push(issue('error', `mp_listing_${field}`, listingFields[field]))
  }

  const nodes = program.chapters.flatMap((chapter) => chapter.nodes.map((node) => ({ chapter, node })))
  if (!nodes.some(({ node }) => node.kind === 'ending')) {
    issues.push(issue('error', 'mp_no_endings', '至少需要一个结局'))
  }
  for (const chapter of data.chapters) {
    if (chapter.runningCount > 0) {
      issues.push(issue('error', 'mp_running', `还有 ${chapter.runningCount} 个生成任务未完成，完成后再发布`, chapter.projectId))
    }
  }

  const refs = collectMediaRefs(program)
  const uniqueMedia = new Set(refs.map((ref) => ref.raw))
  if (uniqueMedia.size > 500) issues.push(issue('error', 'mp_media_limit', '素材超过 500 个，请拆分作品'))

  let videoDurationSec = 0
  for (const { chapter, node } of nodes) {
    const media = node.kind === 'scene' ? node.media : node.kind === 'choice' ? node.backdrop : node.kind === 'interaction' ? node.picture : null
    if (node.kind === 'scene' && !node.media) {
      issues.push(issue('warning', 'mp_scene_no_media', `「${node.title}」没有画面，观众只会看到文字`, chapter.projectId, node.id))
    }
    if (media?.kind === 'video') {
      if (typeof media.durationSec === 'number') videoDurationSec += media.durationSec
      else issues.push(issue('warning', 'mp_video_duration_unknown', `「${node.title}」的视频时长未知，生成版本时会自动检测`, chapter.projectId, node.id))
    }
  }
  if (videoDurationSec > 4 * 3600) issues.push(issue('error', 'mp_duration_limit', '视频总时长超过 4 小时'))

  if (!listing?.coverKey) issues.push(issue('warning', 'mp_no_cover', '未上传竖版封面，将使用开场画面'))

  const inProgress = await prisma.storyRelease.findFirst({ where: { workId, status: { in: ['building', 'reviewing'] } }, select: { id: true } })
  if (inProgress) issues.push(issue('error', 'mp_release_in_progress', '已有一个版本在生成或审核中'))

  const sorted = sortIssues(issues)
  const counts = countIssues(sorted)
  return { issues: sorted, errors: counts.errors, warnings: counts.warnings }
}
