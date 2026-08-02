import type { Prisma } from '@prisma/client'
import type { AuthSession } from '@/lib/api-auth'
import { ApiError } from '@/lib/api-errors'
import { prisma } from '@/lib/prisma'
import { getWorkspaceActor, requireProjectReader } from '@/lib/collaboration/access'

export interface StoryboardReviewSnapshotPanel {
  panelId: string
  storyboardId: string
  sequence: number
  sceneLabel: string
  segmentLabel: string
  label: string
  sourceText: string | null
  description: string | null
  location: string | null
  shotType: string | null
  cameraMove: string | null
  durationSeconds: number | null
  imagePrompt: string | null
  videoPrompt: string | null
  characters: string[]
  props: string[]
  imageUrl: string | null
}

export interface StoryboardReviewSubmissionSnapshot {
  version: 1
  capturedAt: string
  episodeId: string
  episodeName: string | null
  totalPanelCount: number
  panels: StoryboardReviewSnapshotPanel[]
}

function parseStringNames(value: string | null | undefined): string[] {
  if (!value?.trim()) return []
  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.map((item) => {
      if (typeof item === 'string') return item.trim()
      if (!item || typeof item !== 'object' || Array.isArray(item)) return ''
      const name = (item as Record<string, unknown>).name
      return typeof name === 'string' ? name.trim() : ''
    }).filter(Boolean)
  } catch {
    return []
  }
}

type StoryboardReviewDatabase = Pick<Prisma.TransactionClient, 'novelPromotionEpisode'>

export async function buildStoryboardReviewSubmissionSnapshot(
  db: StoryboardReviewDatabase,
  episodeId: string | null,
  options: { requireReady?: boolean } = {},
): Promise<StoryboardReviewSubmissionSnapshot> {
  if (!episodeId) {
    throw new ApiError('CONFLICT', {
      message: '分镜任务未关联分集，无法提交审核。请刷新任务列表后重试。',
    })
  }

  const episode = await db.novelPromotionEpisode.findUnique({
    where: { id: episodeId },
    select: {
      id: true,
      name: true,
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
              imagePrompt: true,
              imageUrl: true,
              videoPrompt: true,
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
  let sequence = 0
  const panels: StoryboardReviewSnapshotPanel[] = []
  storyboards.forEach((storyboard, sceneIndex) => {
    const sceneLabel = `S${String(sceneIndex + 1).padStart(2, '0')}`
    storyboard.panels.forEach((panel) => {
      sequence += 1
      const segmentNumber = panel.panelNumber ?? panel.panelIndex + 1
      const segmentLabel = `Segment ${String(segmentNumber).padStart(2, '0')}`
      panels.push({
        panelId: panel.id,
        storyboardId: storyboard.id,
        sequence,
        sceneLabel,
        segmentLabel,
        label: `${sceneLabel} · ${segmentLabel}`,
        sourceText: panel.srtSegment?.trim() || null,
        description: panel.description?.trim() || null,
        location: panel.location?.trim() || storyboard.clip?.location?.trim() || null,
        shotType: panel.shotType?.trim() || null,
        cameraMove: panel.cameraMove?.trim() || null,
        durationSeconds: typeof panel.duration === 'number' && Number.isFinite(panel.duration)
          ? panel.duration
          : null,
        imagePrompt: panel.imagePrompt?.trim() || null,
        videoPrompt: panel.videoPrompt?.trim() || null,
        characters: parseStringNames(panel.characters),
        props: parseStringNames(panel.props),
        imageUrl: panel.imageUrl?.trim() || null,
      })
    })
  })

  if (options.requireReady && panels.length === 0) {
    throw new ApiError('CONFLICT', {
      message: '本集还没有分镜 Segment，无法提交审核。请先完成本集分镜生成。',
      episodeId,
      panelCount: 0,
    })
  }

  return {
    version: 1,
    capturedAt: new Date().toISOString(),
    episodeId,
    episodeName: episode.name?.trim() || null,
    totalPanelCount: panels.length,
    panels,
  }
}

export function readStoryboardReviewSubmissionSnapshot(
  value: unknown,
): StoryboardReviewSubmissionSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = (value as Record<string, unknown>).storyboardReviewSubmission
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const snapshot = raw as Partial<StoryboardReviewSubmissionSnapshot>
  if (
    snapshot.version !== 1
    || typeof snapshot.episodeId !== 'string'
    || typeof snapshot.totalPanelCount !== 'number'
    || !Array.isArray(snapshot.panels)
  ) return null
  return snapshot as StoryboardReviewSubmissionSnapshot
}

export async function getStoryboardReviewContext(session: AuthSession, assignmentId: string) {
  const actor = getWorkspaceActor(session)
  const assignment = await prisma.workflowAssignment.findFirst({
    where: {
      uuid: assignmentId,
      workspaceOwnerId: actor.workspaceOwnerId,
      stage: 'storyboard',
      matched: true,
    },
    select: {
      uuid: true,
      projectId: true,
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
      episode: { select: { episodeNumber: true, name: true } },
    },
  })
  if (!assignment) throw new ApiError('NOT_FOUND', { message: '分镜审核任务不存在。' })
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
  const submittedSnapshot = readStoryboardReviewSubmissionSnapshot(latestSubmission?.payload)
  const useSubmittedSnapshot = assignment.status === 'pending_review'
    || assignment.status === 'completed'
    || assignment.status === 'rejected'
  const snapshot = useSubmittedSnapshot && submittedSnapshot
    ? submittedSnapshot
    : await buildStoryboardReviewSubmissionSnapshot(prisma, assignment.episodeId)

  return {
    assignment: {
      id: assignment.uuid,
      projectId: assignment.projectId,
      projectName: assignment.project.name,
      workName: assignment.project.work.name,
      episodeId: assignment.episodeId,
      episodeNumber: assignment.episode?.episodeNumber || null,
      episodeName: assignment.episode?.name || null,
      status: assignment.status,
      submittedAt: assignment.submittedAt,
      lastReviewNote: assignment.lastReviewNote,
      canReview: access.canReviewAssignments && assignment.status === 'pending_review',
      canRespond: assignment.assigneeUserId === actor.actorId && assignment.status === 'rejected',
    },
    submissionCapturedAt: submittedSnapshot?.capturedAt || latestSubmission?.createdAt.toISOString() || null,
    snapshotSource: submittedSnapshot ? 'submission' as const : 'live' as const,
    totalPanelCount: snapshot.totalPanelCount,
    panels: snapshot.panels,
  }
}
