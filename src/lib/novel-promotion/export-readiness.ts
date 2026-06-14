import { prisma } from '@/lib/prisma'
import type { ExportDeliveryCardId, ExportDeliveryStats } from '@/lib/novel-promotion/export-delivery'

export type ExportReadinessStatus = 'ready' | 'blocked' | 'available'
export type ExportReadinessBlockerCode = 'ready' | 'missingVideos' | 'noImages' | 'noVoices' | 'noPanels' | 'manifestOnly'

export type ExportReadinessItem = {
  id: string
  cardId: ExportDeliveryCardId
  title: string
  status: ExportReadinessStatus
  blockerCode: ExportReadinessBlockerCode
  blockerParams?: {
    count?: number
  }
  stats: ExportDeliveryStats
}

export type ExportReadiness = {
  projectId: string
  episodeId: string
  stats: ExportDeliveryStats
  items: ExportReadinessItem[]
}

const CARD_TITLES: Record<ExportDeliveryCardId, string> = {
  'final-video': 'Final Video',
  'asset-package': 'Asset Package',
  'voice-package': 'Voice Package',
  'jianying-draft': 'Editing Draft',
}

export function normalizeExportReadinessCardId(value: unknown): ExportDeliveryCardId | null {
  if (value === 'final-video' || value === 'asset-package' || value === 'voice-package' || value === 'jianying-draft') return value
  return null
}

function buildItem(params: {
  id: string
  cardId: ExportDeliveryCardId
  status: ExportReadinessStatus
  blockerCode: ExportReadinessBlockerCode
  blockerParams?: ExportReadinessItem['blockerParams']
  stats: ExportDeliveryStats
}): ExportReadinessItem {
  return {
    id: params.id,
    cardId: params.cardId,
    title: CARD_TITLES[params.cardId],
    status: params.status,
    blockerCode: params.blockerCode,
    ...(params.blockerParams ? { blockerParams: params.blockerParams } : {}),
    stats: params.stats,
  }
}

export function buildExportReadinessItems(stats: ExportDeliveryStats): ExportReadinessItem[] {
  const missingVideos = Math.max(stats.panels - stats.videos, 0)
  const finalVideoReady = stats.panels > 0 && stats.videos > 0 && missingVideos === 0

  return [
    buildItem({
      id: 'queue-final-video',
      cardId: 'final-video',
      status: finalVideoReady ? 'ready' : 'blocked',
      blockerCode: finalVideoReady
        ? 'ready'
        : stats.panels === 0
          ? 'noPanels'
          : 'missingVideos',
      blockerParams: !finalVideoReady && stats.panels > 0 ? { count: missingVideos } : undefined,
      stats,
    }),
    buildItem({
      id: 'queue-asset-package',
      cardId: 'asset-package',
      status: stats.images > 0 ? 'ready' : 'blocked',
      blockerCode: stats.images > 0 ? 'ready' : 'noImages',
      stats,
    }),
    buildItem({
      id: 'queue-voice-package',
      cardId: 'voice-package',
      status: stats.voices > 0 ? 'ready' : 'blocked',
      blockerCode: stats.voices > 0 ? 'ready' : 'noVoices',
      stats,
    }),
    buildItem({
      id: 'queue-editing-draft',
      cardId: 'jianying-draft',
      status: stats.panels > 0 ? 'available' : 'blocked',
      blockerCode: stats.panels > 0 ? 'manifestOnly' : 'noPanels',
      stats,
    }),
  ]
}

export function formatExportReadinessBlocker(item: Pick<ExportReadinessItem, 'blockerCode' | 'blockerParams'>) {
  if (item.blockerCode === 'ready') return 'Current materials satisfy delivery requirements.'
  if (item.blockerCode === 'missingVideos') {
    return `${Math.max(0, Math.round(item.blockerParams?.count || 0))} video shots are still missing.`
  }
  if (item.blockerCode === 'noImages') return 'No storyboard images are ready for packaging.'
  if (item.blockerCode === 'noVoices') return 'No generated voice lines are ready for packaging.'
  if (item.blockerCode === 'noPanels') return 'No shots are available for a delivery manifest.'
  return 'Generates a reviewable manifest before full editing-project packaging.'
}

export async function resolveExportReadiness(params: {
  userId: string
  projectId: string
  episodeId: string
}): Promise<ExportReadiness | null> {
  const project = await prisma.project.findFirst({
    where: {
      id: params.projectId,
      userId: params.userId,
    },
    select: {
      id: true,
      novelPromotionData: {
        select: {
          episodes: {
            where: { id: params.episodeId },
            select: {
              id: true,
              clips: {
                select: { id: true },
              },
              voiceLines: {
                select: { audioUrl: true },
              },
              storyboards: {
                select: {
                  panels: {
                    select: {
                      imageUrl: true,
                      videoUrl: true,
                      lipSyncVideoUrl: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  })

  const episode = project?.novelPromotionData?.episodes[0]
  if (!project || !episode) return null

  const panels = episode.storyboards.flatMap((storyboard) => storyboard.panels)
  const stats: ExportDeliveryStats = {
    clips: episode.clips.length,
    panels: panels.length,
    images: panels.filter((panel) => Boolean(panel.imageUrl)).length,
    videos: panels.filter((panel) => Boolean(panel.videoUrl || panel.lipSyncVideoUrl)).length,
    voices: episode.voiceLines.filter((line) => Boolean(line.audioUrl)).length,
  }

  return {
    projectId: project.id,
    episodeId: episode.id,
    stats,
    items: buildExportReadinessItems(stats),
  }
}
