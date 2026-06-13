import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { readWorkflowStageReview } from '@/lib/workspace/workflow-stage-review-store'

type WorkflowStageId = 'config' | 'script' | 'storyboard' | 'videos' | 'voice' | 'editor'
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

export const GET = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const episodeId = request.nextUrl.searchParams.get('episodeId')

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

  const reviewStates = await readWorkflowStageReview({
    userId: authResult.session.user.id,
    projectId,
    episodeId,
  })

  return NextResponse.json({
    projectId,
    episodeId: episodeId || null,
    source: 'derived',
    updatedAt: new Date().toISOString(),
    reviewStates,
    stages,
  })
})
