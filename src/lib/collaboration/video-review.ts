import type { Prisma } from '@prisma/client'
import type { AuthSession } from '@/lib/api-auth'
import { ApiError } from '@/lib/api-errors'
import { prisma } from '@/lib/prisma'
import { getWorkspaceActor, requireProjectReader } from '@/lib/collaboration/access'
import { TASK_STATUS, TASK_TYPE } from '@/lib/task/types'
import {
  parseRoughCutProject,
  roughCutClipRangeMs,
  type RoughCutSourcePanel,
} from '@/lib/novel-promotion/rough-cut'
import { isCanvasPlaylistScopeId } from '@/lib/canvas/playlist'

const MAX_ANNOTATIONS = 100
const MAX_TIMECODE_MS = 12 * 60 * 60 * 1000
const MAX_NOTE_LENGTH = 1_000

export interface VideoReviewAnnotationInput {
  panelId?: string | null
  startMs: number
  endMs: number
  note: string
}

export interface VideoReviewSnapshotSegment {
  clipId?: string
  panelId: string
  storyboardId: string
  sequence: number
  sceneLabel: string
  segmentLabel: string
  label: string
  description: string | null
  sourceText: string | null
  videoPrompt: string | null
  location: string | null
  shotType: string | null
  cameraMove: string | null
  characters: string[]
  props: string[]
  imageUrl: string | null
  videoUrl: string | null
  startMs: number
  endMs: number
  durationMs: number
  trimStartMs?: number
  trimEndMs?: number
}

export interface VideoReviewSubmissionSnapshot {
  version: 1
  capturedAt: string
  episodeId: string
  episodeName: string | null
  episodeOutputUrl: string | null
  durationMs: number
  totalPanelCount: number
  readyPanelCount: number
  segments: VideoReviewSnapshotSegment[]
}

export interface VideoReviewTarget {
  kind: 'canvas_playlist'
  projectName?: string | null
  canvasId: string
  nodeId: string
  title: string
}

function cleanOptionalId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized ? normalized.slice(0, 191) : null
}

function readTimecodeMs(value: unknown, field: string): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > MAX_TIMECODE_MS) {
    throw new ApiError('INVALID_PARAMS', { message: `${field} 必须是有效的视频时间。` })
  }
  return Math.round(parsed)
}

export function normalizeVideoReviewAnnotations(value: unknown): VideoReviewAnnotationInput[] {
  if (value == null) return []
  if (!Array.isArray(value)) {
    throw new ApiError('INVALID_PARAMS', { message: '视频审查标注格式无效。' })
  }
  if (value.length > MAX_ANNOTATIONS) {
    throw new ApiError('INVALID_PARAMS', { message: `单次审核最多添加 ${MAX_ANNOTATIONS} 条时段标注。` })
  }

  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new ApiError('INVALID_PARAMS', { message: `第 ${index + 1} 条视频标注格式无效。` })
    }
    const row = item as Record<string, unknown>
    const startMs = readTimecodeMs(row.startMs, '开始时间')
    const endMs = readTimecodeMs(row.endMs, '结束时间')
    const note = typeof row.note === 'string' ? row.note.trim() : ''
    if (endMs <= startMs) {
      throw new ApiError('INVALID_PARAMS', { message: `第 ${index + 1} 条标注的结束时间必须晚于开始时间。` })
    }
    if (!note) {
      throw new ApiError('INVALID_PARAMS', { message: `请填写第 ${index + 1} 条时段标注的修改意见。` })
    }
    if (note.length > MAX_NOTE_LENGTH) {
      throw new ApiError('INVALID_PARAMS', { message: `第 ${index + 1} 条时段标注不能超过 ${MAX_NOTE_LENGTH} 字。` })
    }
    return {
      panelId: cleanOptionalId(row.panelId),
      startMs,
      endMs,
      note,
    }
  }).sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs)
}

export async function replaceOpenVideoReviewAnnotations(
  tx: Prisma.TransactionClient,
  input: {
    assignmentUuid: string
    workspaceOwnerId: string
    projectId: string
    episodeId: string | null
    reviewerUserId: string
    annotations: VideoReviewAnnotationInput[]
  },
) {
  await tx.videoReviewAnnotation.deleteMany({
    where: {
      assignmentUuid: input.assignmentUuid,
      workspaceOwnerId: input.workspaceOwnerId,
      status: 'open',
    },
  })
  if (input.annotations.length === 0) return
  await tx.videoReviewAnnotation.createMany({
    data: input.annotations.map((annotation) => ({
      assignmentUuid: input.assignmentUuid,
      workspaceOwnerId: input.workspaceOwnerId,
      projectId: input.projectId,
      episodeId: input.episodeId,
      panelId: annotation.panelId || null,
      reviewerUserId: input.reviewerUserId,
      startMs: annotation.startMs,
      endMs: annotation.endMs,
      note: annotation.note,
      status: 'open',
    })),
  })
}

export async function resolveOpenVideoReviewAnnotations(
  tx: Prisma.TransactionClient,
  assignmentUuid: string,
  resolvedAt: Date,
) {
  await tx.videoReviewAnnotation.updateMany({
    where: { assignmentUuid, status: 'open' },
    data: { status: 'resolved', resolvedAt },
  })
}

export function resolveVideoReviewDurationMs(
  mediaDurationMs: number | null | undefined,
  panelDurationSeconds: number | null | undefined,
): number {
  if (typeof mediaDurationMs === 'number' && Number.isFinite(mediaDurationMs) && mediaDurationMs > 0) {
    return Math.round(mediaDurationMs)
  }
  if (typeof panelDurationSeconds === 'number' && Number.isFinite(panelDurationSeconds) && panelDurationSeconds > 0) {
    return Math.round(panelDurationSeconds * 1_000)
  }
  return 5_000
}

function parseStringNames(value: string | null | undefined): string[] {
  if (!value?.trim()) return []
  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.map((item) => {
      if (typeof item === 'string') return item.trim()
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        const name = (item as Record<string, unknown>).name
        return typeof name === 'string' ? name.trim() : ''
      }
      return ''
    }).filter(Boolean)
  } catch {
    return []
  }
}

type VideoReviewDatabase = Pick<Prisma.TransactionClient, 'novelPromotionEpisode' | 'task'>

export async function buildVideoReviewSubmissionSnapshot(
  db: VideoReviewDatabase,
  episodeId: string | null,
  options: { requireReady?: boolean } = {},
): Promise<{ snapshot: VideoReviewSubmissionSnapshot; activeVideoTaskCount: number; hasSavedTimeline: boolean }> {
  if (!episodeId) {
    throw new ApiError('CONFLICT', {
      message: '视频任务未关联分集，无法提交审核。请刷新任务列表后重试。',
    })
  }

  const episode = await db.novelPromotionEpisode.findUnique({
    where: { id: episodeId },
    select: {
      id: true,
      name: true,
      editorProject: { select: { outputUrl: true, projectData: true } },
      storyboards: {
        select: {
          id: true,
          createdAt: true,
          clip: { select: { start: true, location: true } },
          panels: {
            orderBy: { panelIndex: 'asc' },
            select: {
              id: true,
              panelIndex: true,
              panelNumber: true,
              shotType: true,
              cameraMove: true,
              description: true,
              location: true,
              characters: true,
              props: true,
              srtSegment: true,
              duration: true,
              imageUrl: true,
              videoPrompt: true,
              videoUrl: true,
              videoMedia: { select: { durationMs: true } },
              lipSyncVideoUrl: true,
              lipSyncVideoMedia: { select: { durationMs: true } },
            },
          },
        },
      },
    },
  })
  if (!episode) {
    throw new ApiError('CONFLICT', { message: '任务对应分集已不存在，请刷新后重试。' })
  }

  const storyboards = [...episode.storyboards].sort((left, right) => (
    (left.clip?.start ?? Number.MAX_SAFE_INTEGER) - (right.clip?.start ?? Number.MAX_SAFE_INTEGER)
    || left.createdAt.getTime() - right.createdAt.getTime()
    || left.id.localeCompare(right.id)
  ))
  const panelIds = storyboards.flatMap((storyboard) => storyboard.panels.map((panel) => panel.id))
  const activeVideoTaskCount = panelIds.length > 0
    ? await db.task.count({
      where: {
        targetType: 'NovelPromotionPanel',
        targetId: { in: panelIds },
        type: { in: [TASK_TYPE.VIDEO_PANEL, TASK_TYPE.LIP_SYNC] },
        status: { in: [TASK_STATUS.QUEUED, TASK_STATUS.PROCESSING] },
      },
    })
    : 0

  let cursorMs = 0
  let sequence = 0
  let segments: VideoReviewSnapshotSegment[] = []
  storyboards.forEach((storyboard, sceneIndex) => {
    const sceneLabel = `S${String(sceneIndex + 1).padStart(2, '0')}`
    storyboard.panels.forEach((panel) => {
      sequence += 1
      const lipSyncVideoUrl = panel.lipSyncVideoUrl?.trim() || null
      const videoUrl = lipSyncVideoUrl || panel.videoUrl?.trim() || null
      const mediaDurationMs = lipSyncVideoUrl
        ? panel.lipSyncVideoMedia?.durationMs
        : panel.videoMedia?.durationMs
      const durationMs = resolveVideoReviewDurationMs(mediaDurationMs, panel.duration)
      const startMs = cursorMs
      cursorMs += durationMs
      const segmentNumber = panel.panelNumber ?? panel.panelIndex + 1
      const segmentLabel = `Segment ${String(segmentNumber).padStart(2, '0')}`
      segments.push({
        panelId: panel.id,
        storyboardId: storyboard.id,
        sequence,
        sceneLabel,
        segmentLabel,
        label: `${sceneLabel} · ${segmentLabel}`,
        description: panel.description?.trim() || null,
        sourceText: panel.srtSegment?.trim() || null,
        videoPrompt: panel.videoPrompt?.trim() || null,
        location: panel.location?.trim() || storyboard.clip?.location?.trim() || null,
        shotType: panel.shotType?.trim() || null,
        cameraMove: panel.cameraMove?.trim() || null,
        characters: parseStringNames(panel.characters),
        props: parseStringNames(panel.props),
        imageUrl: panel.imageUrl?.trim() || null,
        videoUrl,
        startMs,
        endMs: cursorMs,
        durationMs,
      })
    })
  })

  const totalPanelCount = segments.length
  const readyPanelCount = segments.filter((segment) => Boolean(segment.videoUrl)).length

  const roughCutSources: RoughCutSourcePanel[] = segments.map((segment) => ({
    panelId: segment.panelId,
    storyboardId: segment.storyboardId,
    sceneLabel: segment.sceneLabel,
    segmentLabel: segment.segmentLabel,
    description: segment.description,
    imageUrl: segment.imageUrl,
    videoUrl: segment.videoUrl || '',
    durationMs: segment.durationMs,
  }))
  const roughCut = parseRoughCutProject(episode.editorProject?.projectData, episode.id, roughCutSources)
  const hasSavedTimeline = Boolean(roughCut)
  if (roughCut) {
    const sourceSegments = new Map(segments.map((segment) => [segment.panelId, segment]))
    cursorMs = 0
    segments = roughCut.timeline.flatMap((clip, index) => {
      const source = sourceSegments.get(clip.metadata.panelId)
      if (!source) return []
      const range = roughCutClipRangeMs(clip, roughCut.config.fps)
      const startMs = cursorMs
      cursorMs += range.durationMs
      return [{
        ...source,
        clipId: clip.id,
        sequence: index + 1,
        label: `${source.sceneLabel} · ${source.segmentLabel} · 剪辑 ${String(index + 1).padStart(2, '0')}`,
        startMs,
        endMs: cursorMs,
        durationMs: range.durationMs,
        trimStartMs: range.trimStartMs,
        trimEndMs: range.trimEndMs,
      }]
    })
  }

  if (options.requireReady && totalPanelCount === 0) {
    throw new ApiError('CONFLICT', {
      message: '本集还没有 Segment，无法提交视频审核。请先完成分镜设计和视频制作。',
      episodeId,
      panelCount: 0,
    })
  }
  if (options.requireReady && !hasSavedTimeline) {
    throw new ApiError('CONFLICT', {
      message: '请先进入剪辑页保存本集剪辑，再提交审核。',
      episodeId,
      panelCount: totalPanelCount,
    })
  }
  if (options.requireReady && segments.length === 0) {
    throw new ApiError('CONFLICT', {
      message: '组装时间线为空，无法提交审核。请至少保留一个剪辑片段并保存。',
      episodeId,
    })
  }
  if (options.requireReady && segments.some((segment) => !segment.videoUrl)) {
    throw new ApiError('CONFLICT', {
      message: '保存的剪辑包含不可用视频，请移除或重新生成对应片段后再次保存。',
      episodeId,
    })
  }

  return {
    snapshot: {
      version: 1,
      capturedAt: new Date().toISOString(),
      episodeId,
      episodeName: episode.name?.trim() || null,
      episodeOutputUrl: episode.editorProject?.outputUrl?.trim() || null,
      durationMs: cursorMs,
      totalPanelCount,
      readyPanelCount,
      segments,
    },
    activeVideoTaskCount,
    hasSavedTimeline,
  }
}

export function readVideoReviewSubmissionSnapshot(value: unknown): VideoReviewSubmissionSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const payload = value as Record<string, unknown>
  const raw = payload.reviewSubmission
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const snapshot = raw as Partial<VideoReviewSubmissionSnapshot>
  if (
    snapshot.version !== 1
    || typeof snapshot.episodeId !== 'string'
    || !Array.isArray(snapshot.segments)
    || typeof snapshot.durationMs !== 'number'
  ) return null
  return snapshot as VideoReviewSubmissionSnapshot
}

export function readVideoReviewTarget(value: unknown): VideoReviewTarget | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = (value as Record<string, unknown>).reviewTarget
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const target = raw as Record<string, unknown>
  if (target.kind !== 'canvas_playlist' || typeof target.canvasId !== 'string' || typeof target.nodeId !== 'string') return null
  return {
    kind: 'canvas_playlist',
    projectName: typeof target.projectName === 'string' ? target.projectName : null,
    canvasId: target.canvasId,
    nodeId: target.nodeId,
    title: typeof target.title === 'string' && target.title.trim() ? target.title.trim() : '画布播放列表',
  }
}

export function validateVideoReviewAnnotationsAgainstSnapshot(
  annotations: VideoReviewAnnotationInput[],
  snapshot: VideoReviewSubmissionSnapshot,
) {
  const segments = new Map<string, VideoReviewSnapshotSegment[]>()
  for (const segment of snapshot.segments) {
    const matches = segments.get(segment.panelId) || []
    matches.push(segment)
    segments.set(segment.panelId, matches)
  }
  for (const [index, annotation] of annotations.entries()) {
    if (!annotation.panelId) {
      if (annotation.endMs > snapshot.durationMs) {
        throw new ApiError('INVALID_PARAMS', {
          message: `第 ${index + 1} 条整集标注超出了本集视频时长。`,
        })
      }
      continue
    }
    const matchingSegments = segments.get(annotation.panelId)
    if (!matchingSegments?.length) {
      throw new ApiError('INVALID_PARAMS', {
        message: `第 ${index + 1} 条标注对应的 Segment 不在本次提交中。`,
      })
    }
    const segment = matchingSegments.find((candidate) => (
      annotation.startMs >= candidate.startMs && annotation.endMs <= candidate.endMs
    ))
    if (!segment) {
      const labels = Array.from(new Set(matchingSegments.map((candidate) => candidate.label).filter(Boolean)))
      throw new ApiError('INVALID_PARAMS', {
        message: `第 ${index + 1} 条标注的时间范围超出了 ${labels.join('、') || '对应 Segment'} 的剪辑片段范围。`,
      })
    }
  }
}

export async function getVideoReviewContext(session: AuthSession, assignmentId: string) {
  const actor = getWorkspaceActor(session)
  const assignment = await prisma.workflowAssignment.findFirst({
    where: {
      uuid: assignmentId,
      workspaceOwnerId: actor.workspaceOwnerId,
      stage: 'video',
      matched: true,
    },
    select: {
      uuid: true,
      projectId: true,
      scopeId: true,
      episodeId: true,
      status: true,
      assigneeUserId: true,
      submittedAt: true,
      lastReviewNote: true,
      project: {
        select: {
          name: true,
          work: { select: { name: true } },
        },
      },
      episode: { select: { id: true, episodeNumber: true, name: true } },
    },
  })
  if (!assignment) {
    throw new ApiError('NOT_FOUND', { message: '视频审查任务不存在。' })
  }
  const access = await requireProjectReader(session, assignment.projectId)

  const latestSubmission = await prisma.workflowAssignmentEvent.findFirst({
    where: {
      assignmentUuid: assignment.uuid,
      workspaceOwnerId: actor.workspaceOwnerId,
      eventType: 'submit',
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { payload: true, createdAt: true },
  })
  const submittedSnapshot = readVideoReviewSubmissionSnapshot(latestSubmission?.payload)
  const reviewTarget = readVideoReviewTarget(latestSubmission?.payload)
  const isCanvasPlaylist = isCanvasPlaylistScopeId(assignment.scopeId) || reviewTarget?.kind === 'canvas_playlist'
  const useSubmittedSnapshot = assignment.status === 'pending_review'
    || assignment.status === 'completed'
    || assignment.status === 'rejected'
  if (isCanvasPlaylist && !submittedSnapshot) {
    throw new ApiError('CONFLICT', { message: '播放列表提交快照不存在，请返回画布重新提交。' })
  }
  const needsLiveState = !isCanvasPlaylist && (
    !submittedSnapshot
    || assignment.status === 'in_progress'
    || assignment.status === 'rejected'
  )
  const live = needsLiveState
    ? await buildVideoReviewSubmissionSnapshot(prisma, assignment.episodeId)
    : null
  const snapshot = (isCanvasPlaylist || useSubmittedSnapshot) && submittedSnapshot
    ? submittedSnapshot
    : live!.snapshot
  const activeVideoTaskCount = live?.activeVideoTaskCount || 0
  const readyForReview = live
    ? live.hasSavedTimeline && live.snapshot.segments.length > 0 && live.snapshot.segments.every((segment) => Boolean(segment.videoUrl))
    : snapshot.segments.length > 0 && snapshot.segments.every((segment) => Boolean(segment.videoUrl))
  const segmentSources = snapshot.segments.map((segment) => ({
    id: segment.clipId || segment.panelId,
    kind: 'segment' as const,
    ...segment,
  }))
  const sources = [{
    id: `episode:${snapshot.episodeId}:sequence`,
    kind: 'episode' as const,
    panelId: null,
    label: '整集连续预览',
    description: snapshot.episodeName,
    videoUrl: snapshot.episodeOutputUrl,
    startMs: 0,
    endMs: snapshot.durationMs,
    durationMs: snapshot.durationMs,
    virtualSequence: !snapshot.episodeOutputUrl,
  }, ...segmentSources]

  const annotations = await prisma.videoReviewAnnotation.findMany({
    where: {
      assignmentUuid: assignment.uuid,
      workspaceOwnerId: actor.workspaceOwnerId,
    },
    orderBy: [{ status: 'asc' }, { startMs: 'asc' }, { createdAt: 'asc' }],
    take: 200,
    select: {
      id: true,
      panelId: true,
      startMs: true,
      endMs: true,
      note: true,
      status: true,
      resolvedAt: true,
      createdAt: true,
      updatedAt: true,
    },
  })

  return {
    assignment: {
      id: assignment.uuid,
      projectId: assignment.projectId,
      projectName: assignment.project.name,
      workName: assignment.project.work.name,
      episodeId: assignment.episodeId,
      episodeNumber: assignment.episode?.episodeNumber || null,
      episodeName: assignment.episode?.name || snapshot.episodeName || null,
      status: assignment.status,
      submittedAt: assignment.submittedAt,
      lastReviewNote: assignment.lastReviewNote,
      canAnnotate: access.canReviewAssignments && assignment.status === 'pending_review',
      canRespond: assignment.assigneeUserId === actor.actorId && assignment.status === 'rejected',
    },
    submissionCapturedAt: submittedSnapshot?.capturedAt || latestSubmission?.createdAt.toISOString() || null,
    reviewTarget,
    sources,
    durationMs: snapshot.durationMs,
    totalPanelCount: snapshot.totalPanelCount,
    readyPanelCount: snapshot.readyPanelCount,
    activeVideoTaskCount,
    readyForReview,
    annotations,
  }
}
