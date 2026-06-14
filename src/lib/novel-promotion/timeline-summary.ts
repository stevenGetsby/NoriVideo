const DEFAULT_TIMELINE_PANEL_DURATION_SECONDS = 3

export type TimelinePanelSource = {
  id: string
  storyboardId: string
  clipId?: string | null
  clipSummary?: string | null
  panelIndex: number
  panelNumber?: number | null
  shotType?: string | null
  cameraMove?: string | null
  description?: string | null
  location?: string | null
  characters?: string | null
  props?: string | null
  duration?: number | null
  imagePrompt?: string | null
  imageUrl?: string | null
  videoPrompt?: string | null
  videoUrl?: string | null
  lipSyncVideoUrl?: string | null
  srtSegment?: string | null
  srtStart?: number | null
  srtEnd?: number | null
}

export type TimelineStoryboardSource = {
  id: string
  clipId?: string | null
  clip?: {
    id: string
    summary?: string | null
    start?: number | null
    end?: number | null
    duration?: number | null
    shotCount?: number | null
  } | null
  panelCount?: number | null
  panels: TimelinePanelSource[]
}

export type TimelineEpisodeSource = {
  id: string
  episodeNumber: number
  name: string
  description?: string | null
  storyboards: TimelineStoryboardSource[]
}

export type TimelinePanelStatus = 'ready' | 'needs_refs' | 'needs_image' | 'needs_video' | 'needs_duration'
export type TimelineEpisodeStatus = 'empty' | 'ready' | 'blocked' | 'needs_assets' | 'needs_video' | 'needs_duration'

export type TimelineSummaryInput = {
  projectId: string
  generatedAt?: string
  scope: 'project' | 'episode'
  episodes: TimelineEpisodeSource[]
}

function hasText(value: string | null | undefined) {
  return typeof value === 'string' && value.trim().length > 0
}

function isPositiveNumber(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function roundSeconds(value: number) {
  return Math.round(value * 10) / 10
}

function resolvePanelStatus(params: {
  hasRefs: boolean
  hasImage: boolean
  hasVideo: boolean
  hasDuration: boolean
}): TimelinePanelStatus {
  if (!params.hasRefs) return 'needs_refs'
  if (!params.hasImage) return 'needs_image'
  if (!params.hasVideo) return 'needs_video'
  if (!params.hasDuration) return 'needs_duration'
  return 'ready'
}

function resolveEpisodeStatus(stats: {
  panels: number
  missingRefs: number
  missingImages: number
  missingVideos: number
  missingDurations: number
}): TimelineEpisodeStatus {
  if (stats.panels === 0) return 'empty'
  if (stats.missingRefs > 0) return 'blocked'
  if (stats.missingImages > 0) return 'needs_assets'
  if (stats.missingVideos > 0) return 'needs_video'
  if (stats.missingDurations > 0) return 'needs_duration'
  return 'ready'
}

export function buildTimelineSummary(input: TimelineSummaryInput) {
  const generatedAt = input.generatedAt || new Date().toISOString()
  const episodes = input.episodes.map((episode) => {
    let cursorSeconds = 0
    const timeline = episode.storyboards.flatMap((storyboard, storyboardIndex) => (
      storyboard.panels.map((panel) => {
        const hasRefs = hasText(panel.characters) || hasText(panel.location) || hasText(panel.props)
        const hasImage = hasText(panel.imageUrl)
        const hasVideo = hasText(panel.videoUrl) || hasText(panel.lipSyncVideoUrl)
        const hasDuration = isPositiveNumber(panel.duration)
        const durationSeconds = hasDuration
          ? roundSeconds(panel.duration as number)
          : DEFAULT_TIMELINE_PANEL_DURATION_SECONDS
        const startSeconds = roundSeconds(cursorSeconds)
        cursorSeconds = roundSeconds(cursorSeconds + durationSeconds)
        const status = resolvePanelStatus({ hasRefs, hasImage, hasVideo, hasDuration })

        return {
          id: panel.id,
          storyboardId: panel.storyboardId,
          storyboardIndex: storyboardIndex + 1,
          clipId: panel.clipId || storyboard.clipId || storyboard.clip?.id || null,
          clipSummary: panel.clipSummary || storyboard.clip?.summary || null,
          panelIndex: panel.panelIndex,
          panelNumber: panel.panelNumber ?? panel.panelIndex + 1,
          timelineIndex: 0,
          startSeconds,
          endSeconds: cursorSeconds,
          durationSeconds,
          durationSource: hasDuration ? 'panel' as const : 'default' as const,
          status,
          readiness: {
            hasRefs,
            hasImage,
            hasVideo,
            hasDuration,
          },
          text: {
            description: panel.description || panel.srtSegment || null,
            shotType: panel.shotType || null,
            cameraMove: panel.cameraMove || null,
            imagePrompt: panel.imagePrompt || null,
            videoPrompt: panel.videoPrompt || null,
          },
          refs: {
            characters: panel.characters || null,
            location: panel.location || null,
            props: panel.props || null,
          },
          media: {
            imageUrl: panel.imageUrl || null,
            videoUrl: panel.videoUrl || null,
            lipSyncVideoUrl: panel.lipSyncVideoUrl || null,
          },
          srt: {
            segment: panel.srtSegment || null,
            start: panel.srtStart ?? null,
            end: panel.srtEnd ?? null,
          },
        }
      })
    )).map((row, index) => ({
      ...row,
      timelineIndex: index + 1,
    }))

    const stats = {
      storyboards: episode.storyboards.length,
      expectedPanels: episode.storyboards.reduce((sum, storyboard) => (
        sum + Math.max(storyboard.panelCount || 0, storyboard.panels.length)
      ), 0),
      panels: timeline.length,
      images: timeline.filter((panel) => panel.readiness.hasImage).length,
      videos: timeline.filter((panel) => panel.readiness.hasVideo).length,
      refsReady: timeline.filter((panel) => panel.readiness.hasRefs).length,
      durationsReady: timeline.filter((panel) => panel.readiness.hasDuration).length,
      readyShots: timeline.filter((panel) => panel.status === 'ready').length,
      missingImages: timeline.filter((panel) => !panel.readiness.hasImage).length,
      missingVideos: timeline.filter((panel) => !panel.readiness.hasVideo).length,
      missingRefs: timeline.filter((panel) => !panel.readiness.hasRefs).length,
      missingDurations: timeline.filter((panel) => !panel.readiness.hasDuration).length,
      scheduledDurationSeconds: roundSeconds(cursorSeconds),
      confirmedDurationSeconds: roundSeconds(
        timeline
          .filter((panel) => panel.durationSource === 'panel')
          .reduce((sum, panel) => sum + panel.durationSeconds, 0),
      ),
    }
    const averageBase = stats.durationsReady > 0 ? stats.confirmedDurationSeconds / stats.durationsReady : 0

    return {
      id: episode.id,
      episodeNumber: episode.episodeNumber,
      name: episode.name,
      description: episode.description || null,
      status: resolveEpisodeStatus(stats),
      stats: {
        ...stats,
        averageDurationSeconds: roundSeconds(averageBase),
      },
      queues: {
        refs: timeline.filter((panel) => !panel.readiness.hasRefs).map((panel) => panel.id),
        images: timeline.filter((panel) => !panel.readiness.hasImage).map((panel) => panel.id),
        videos: timeline.filter((panel) => !panel.readiness.hasVideo).map((panel) => panel.id),
        durations: timeline.filter((panel) => !panel.readiness.hasDuration).map((panel) => panel.id),
      },
      timeline,
    }
  })

  const totals = episodes.reduce((current, episode) => ({
    episodes: current.episodes + 1,
    storyboards: current.storyboards + episode.stats.storyboards,
    panels: current.panels + episode.stats.panels,
    images: current.images + episode.stats.images,
    videos: current.videos + episode.stats.videos,
    readyShots: current.readyShots + episode.stats.readyShots,
    missingRefs: current.missingRefs + episode.stats.missingRefs,
    missingImages: current.missingImages + episode.stats.missingImages,
    missingVideos: current.missingVideos + episode.stats.missingVideos,
    missingDurations: current.missingDurations + episode.stats.missingDurations,
    scheduledDurationSeconds: roundSeconds(current.scheduledDurationSeconds + episode.stats.scheduledDurationSeconds),
    confirmedDurationSeconds: roundSeconds(current.confirmedDurationSeconds + episode.stats.confirmedDurationSeconds),
  }), {
    episodes: 0,
    storyboards: 0,
    panels: 0,
    images: 0,
    videos: 0,
    readyShots: 0,
    missingRefs: 0,
    missingImages: 0,
    missingVideos: 0,
    missingDurations: 0,
    scheduledDurationSeconds: 0,
    confirmedDurationSeconds: 0,
  })

  return {
    success: true,
    schema: 'nori-video.timeline-summary.v1',
    generatedAt,
    projectId: input.projectId,
    scope: input.scope,
    totals,
    episodes,
  }
}
