import { prisma } from '@/lib/prisma'
import { TASK_STATUS } from '@/lib/task/types'
import { containsInternalRecordMarker } from '@/lib/workspace/internal-record-visibility'

export type RebuildImpactCounts = {
  storyboardCount: number
  panelCount: number
  imageCount: number
  videoCount: number
  voiceLineCount: number
  voiceAudioCount: number
  editorProjectCount: number
  exportQueueCount: number
  exportHistoryCount: number
  activeTaskCount: number
}

type EpisodeImpactSource = {
  storyboards: Array<{
    panels: Array<{
      imageUrl: string | null
      imageMediaId: string | null
      videoUrl: string | null
      videoMediaId: string | null
      lipSyncVideoUrl: string | null
      lipSyncVideoMediaId: string | null
    }>
  }>
  voiceLines: Array<{
    audioUrl: string | null
    audioMediaId: string | null
  }>
  editorProject: { id: string } | null
}

function hasValue(value: string | null | undefined) {
  return typeof value === 'string' && value.trim().length > 0
}

export function summarizeRebuildImpact(source: EpisodeImpactSource, relatedCounts?: {
  exportQueueCount?: number
  exportHistoryCount?: number
  activeTaskCount?: number
}): RebuildImpactCounts {
  const panels = source.storyboards.flatMap((storyboard) => storyboard.panels)
  const imageCount = panels.filter((panel) => (
    hasValue(panel.imageUrl) || hasValue(panel.imageMediaId)
  )).length
  const videoCount = panels.filter((panel) => (
    hasValue(panel.videoUrl)
    || hasValue(panel.videoMediaId)
    || hasValue(panel.lipSyncVideoUrl)
    || hasValue(panel.lipSyncVideoMediaId)
  )).length
  const voiceAudioCount = source.voiceLines.filter((line) => (
    hasValue(line.audioUrl) || hasValue(line.audioMediaId)
  )).length

  return {
    storyboardCount: source.storyboards.length,
    panelCount: panels.length,
    imageCount,
    videoCount,
    voiceLineCount: source.voiceLines.length,
    voiceAudioCount,
    editorProjectCount: source.editorProject ? 1 : 0,
    exportQueueCount: Math.max(0, relatedCounts?.exportQueueCount ?? 0),
    exportHistoryCount: Math.max(0, relatedCounts?.exportHistoryCount ?? 0),
    activeTaskCount: Math.max(0, relatedCounts?.activeTaskCount ?? 0),
  }
}

export function hasRebuildImpact(counts: RebuildImpactCounts) {
  return Object.values(counts).some((count) => count > 0)
}

export async function readEpisodeRebuildImpact(params: {
  userId: string
  projectId: string
  episodeId: string
}) {
  const episode = await prisma.novelPromotionEpisode.findFirst({
    where: {
      id: params.episodeId,
      novelPromotionProject: {
        projectId: params.projectId,
        project: { userId: params.userId },
      },
    },
    select: {
      id: true,
      storyboards: {
        select: {
          panels: {
            select: {
              imageUrl: true,
              imageMediaId: true,
              videoUrl: true,
              videoMediaId: true,
              lipSyncVideoUrl: true,
              lipSyncVideoMediaId: true,
            },
          },
        },
      },
      voiceLines: {
        select: {
          audioUrl: true,
          audioMediaId: true,
        },
      },
      editorProject: {
        select: { id: true },
      },
    },
  })

  if (!episode) return null

  const [exportQueueCount, exportHistoryCount, activeTasks] = await Promise.all([
    prisma.exportQueueRecord.count({
      where: {
        userId: params.userId,
        projectId: params.projectId,
        scopeId: params.episodeId,
      },
    }),
    prisma.exportHistoryRecord.count({
      where: {
        userId: params.userId,
        projectId: params.projectId,
        scopeId: params.episodeId,
      },
    }),
    prisma.task.findMany({
      where: {
        userId: params.userId,
        projectId: params.projectId,
        episodeId: params.episodeId,
        status: { in: [TASK_STATUS.QUEUED, TASK_STATUS.PROCESSING] },
      },
      select: {
        type: true,
        targetType: true,
        errorMessage: true,
      },
    }),
  ])
  const activeTaskCount = activeTasks.filter((task) => (
    !containsInternalRecordMarker(task.type, task.targetType, task.errorMessage)
  )).length

  const counts = summarizeRebuildImpact(episode, {
    exportQueueCount,
    exportHistoryCount,
    activeTaskCount,
  })

  return {
    projectId: params.projectId,
    episodeId: params.episodeId,
    source: 'server' as const,
    updatedAt: new Date().toISOString(),
    shouldConfirm: hasRebuildImpact(counts),
    counts,
  }
}
