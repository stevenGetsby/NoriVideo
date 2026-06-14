import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { readWorkflowStageReviewWithMeta } from '@/lib/workspace/workflow-stage-review-store'

const WORKFLOW_STAGE_IDS = ['config', 'script', 'storyboard', 'videos', 'voice', 'editor'] as const

type WorkflowStageId = typeof WORKFLOW_STAGE_IDS[number]
type WorkflowStageStatus = 'empty' | 'active' | 'processing' | 'ready'

function hasText(value: string | null | undefined) {
  return typeof value === 'string' && value.trim().length > 0
}

function resolveStatus(hasOutput: boolean, canStart: boolean): WorkflowStageStatus {
  if (hasOutput) return 'ready'
  if (canStart) return 'active'
  return 'empty'
}

function buildStage(
  id: WorkflowStageId,
  status: WorkflowStageStatus,
  progress: number,
  counts: Record<string, number>,
  reason: string,
) {
  return {
    id,
    status,
    progress: Math.max(0, Math.min(100, Math.round(progress))),
    counts,
    reason,
  }
}

function toObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function readSummaryText(value: unknown) {
  const summary = toObject(value)
  return typeof summary.message === 'string' && summary.message.trim() ? summary.message.trim() : null
}

function overlayRuntimeStages(
  stages: ReturnType<typeof buildStage>[],
  rows: Array<{
    stageKey: string
    status: string
    progress: number | null
    lastRunId: string | null
    lastTaskId: string | null
    summary: unknown
    errorCode: string | null
    errorMessage: string | null
    blocker: string | null
    updatedAt: Date
  }>,
) {
  const runtimeMap = new Map<string, (typeof rows)[number]>()
  for (const row of rows) {
    if (!runtimeMap.has(row.stageKey)) {
      runtimeMap.set(row.stageKey, row)
    }
  }
  return stages.map((stage) => {
    const runtime = runtimeMap.get(stage.id)
    if (!runtime) return stage

    const runtimeIsActive = runtime.status === 'queued' || runtime.status === 'running'
    const runtimeIsFailed = runtime.status === 'failed' || runtime.status === 'canceled'
    const runtimeProgress = typeof runtime.progress === 'number' ? runtime.progress : null
    const nextProgress = runtimeProgress === null
      ? stage.progress
      : runtimeIsActive
        ? Math.max(stage.progress, runtimeProgress)
        : runtime.status === 'completed'
          ? Math.max(stage.progress, runtimeProgress)
          : stage.progress

    return {
      ...stage,
      status: runtimeIsActive && stage.status !== 'ready' ? 'processing' as const : stage.status,
      progress: Math.max(0, Math.min(100, Math.round(nextProgress))),
      reason: runtimeIsFailed
        ? (runtime.errorMessage || runtime.blocker || stage.reason)
        : stage.reason,
      runtimeState: runtime.status,
      runtimeUpdatedAt: runtime.updatedAt.toISOString(),
      runtimeMessage: readSummaryText(runtime.summary),
      lastRunId: runtime.lastRunId,
      lastTaskId: runtime.lastTaskId,
      errorCode: runtime.errorCode,
      errorMessage: runtime.errorMessage,
    }
  })
}

export const GET = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const episodeId = request.nextUrl.searchParams.get('episodeId')?.trim() || null

  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const novelPromotionData = await prisma.novelPromotionProject.findUnique({
    where: { projectId },
    include: {
      characters: true,
      locations: true,
      episodes: {
        where: episodeId ? { id: episodeId } : undefined,
        orderBy: { episodeNumber: 'asc' },
        include: {
          editorProject: true,
          voiceLines: true,
          clips: true,
          storyboards: {
            include: {
              panels: true,
            },
          },
        },
      },
    },
  })

  if (!novelPromotionData) {
    throw new ApiError('NOT_FOUND')
  }
  if (episodeId && novelPromotionData.episodes.length === 0) {
    throw new ApiError('NOT_FOUND')
  }

  const episodes = novelPromotionData.episodes
  const clips = episodes.flatMap((episode) => episode.clips)
  const storyboards = episodes.flatMap((episode) => episode.storyboards)
  const panels = storyboards.flatMap((storyboard) => storyboard.panels)
  const voiceLines = episodes.flatMap((episode) => episode.voiceLines)
  const editorProjects = episodes.map((episode) => episode.editorProject).filter(Boolean)

  const storyCount = episodes.filter((episode) => hasText(episode.novelText)).length
  const scriptCount = clips.filter((clip) => hasText(clip.screenplay)).length
  const imageCount = panels.filter((panel) => hasText(panel.imageUrl)).length
  const videoCount = panels.filter((panel) => hasText(panel.videoUrl) || hasText(panel.lipSyncVideoUrl)).length
  const voiceCount = voiceLines.filter((line) => hasText(line.audioUrl)).length
  const assetCount = novelPromotionData.characters.length + novelPromotionData.locations.length

  const totalEpisodes = Math.max(episodes.length, 1)
  const totalClips = Math.max(clips.length, 1)
  const totalPanels = Math.max(panels.length, 1)
  const totalVoiceLines = Math.max(voiceLines.length, 1)

  const hasStory = storyCount > 0
  const hasScript = scriptCount > 0
  const hasStoryboard = panels.length > 0
  const hasVideo = videoCount > 0
  const hasVoice = voiceCount > 0 || voiceLines.length > 0
  const hasEditorDraft = editorProjects.length > 0 || hasVideo

  const stages = [
    buildStage(
      'config',
      resolveStatus(hasStory, episodes.length > 0),
      (storyCount / totalEpisodes) * 100,
      { episodes: episodes.length, stories: storyCount },
      hasStory ? 'story_input_ready' : 'waiting_for_story_input',
    ),
    buildStage(
      'script',
      resolveStatus(hasScript || assetCount > 0, hasStory),
      Math.max((scriptCount / totalClips) * 100, assetCount > 0 ? 35 : 0),
      {
        clips: clips.length,
        scripts: scriptCount,
        characters: novelPromotionData.characters.length,
        assets: assetCount,
      },
      hasScript ? 'script_and_assets_ready' : 'waiting_for_script_assets',
    ),
    buildStage(
      'storyboard',
      resolveStatus(hasStoryboard, hasScript),
      (panels.length / totalPanels) * 100,
      { storyboards: storyboards.length, panels: panels.length, images: imageCount },
      hasStoryboard ? 'storyboard_ready' : 'waiting_for_storyboard',
    ),
    buildStage(
      'videos',
      resolveStatus(hasVideo, hasStoryboard),
      (videoCount / totalPanels) * 100,
      { panels: panels.length, videos: videoCount, missingVideos: Math.max(panels.length - videoCount, 0) },
      hasVideo ? 'video_ready' : 'waiting_for_video',
    ),
    buildStage(
      'voice',
      resolveStatus(hasVoice, hasStory),
      voiceLines.length > 0 ? (voiceCount / totalVoiceLines) * 100 : 0,
      { voiceLines: voiceLines.length, audios: voiceCount },
      hasVoice ? 'voice_ready' : 'waiting_for_voice',
    ),
    buildStage(
      'editor',
      resolveStatus(hasEditorDraft, hasVideo),
      hasEditorDraft ? 100 : 0,
      { editorProjects: editorProjects.length, videos: videoCount },
      hasEditorDraft ? 'delivery_ready' : 'waiting_for_delivery_assets',
    ),
  ]

  const reviewPayload = await readWorkflowStageReviewWithMeta({
    userId: authResult.session.user.id,
    projectId,
    episodeId,
  })
  const runtimeRows = await prisma.workflowStageState.findMany({
    where: {
      userId: authResult.session.user.id,
      projectId,
      scopeId: episodeId || 'project',
      stageKey: {
        in: [...WORKFLOW_STAGE_IDS],
      },
      status: {
        in: ['queued', 'running', 'completed', 'failed', 'canceled', 'pending_review', 'approved', 'stale'],
      },
    },
    select: {
      stageKey: true,
      status: true,
      progress: true,
      lastRunId: true,
      lastTaskId: true,
      summary: true,
      errorCode: true,
      errorMessage: true,
      blocker: true,
      updatedAt: true,
    },
    orderBy: {
      updatedAt: 'desc',
    },
  })
  const stagesWithRuntime = overlayRuntimeStages(stages, runtimeRows)

  return NextResponse.json({
    projectId,
    episodeId: episodeId || null,
    source: 'derived',
    updatedAt: new Date().toISOString(),
    reviewStateSource: reviewPayload.source,
    reviewStates: reviewPayload.states,
    stages: stagesWithRuntime,
  })
})
