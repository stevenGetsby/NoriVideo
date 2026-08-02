import type { VideoClip, VideoEditorProject } from '@/features/video-editor/types/editor.types'

export const ROUGH_CUT_FPS = 30
export const MAX_ROUGH_CUT_CLIPS = 500

export interface RoughCutSourcePanel {
  panelId: string
  storyboardId: string
  sceneLabel: string
  segmentLabel: string
  description: string | null
  imageUrl: string | null
  videoUrl: string
  durationMs: number
  sourceText?: string | null
  videoPrompt?: string | null
  location?: string | null
  shotType?: string | null
  cameraMove?: string | null
  characters?: string[]
  props?: string[]
}

export interface RoughCutDimensions {
  width: number
  height: number
}

export function roughCutDimensionsForRatio(value: string | null | undefined): RoughCutDimensions {
  const match = value?.trim().match(/^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/)
  if (!match) return { width: 1080, height: 1920 }
  const widthRatio = Number(match[1])
  const heightRatio = Number(match[2])
  if (!Number.isFinite(widthRatio) || !Number.isFinite(heightRatio) || widthRatio <= 0 || heightRatio <= 0) {
    return { width: 1080, height: 1920 }
  }
  if (widthRatio === heightRatio) return { width: 1080, height: 1080 }
  return widthRatio > heightRatio
    ? { width: 1920, height: Math.max(320, Math.round(1920 * (heightRatio / widthRatio))) }
    : { width: Math.max(320, Math.round(1920 * (widthRatio / heightRatio))), height: 1920 }
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value))
}

function finiteInteger(value: unknown, fallback: number) {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? Math.round(parsed) : fallback
}

function cleanId(value: unknown, fallback: string) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 191) : fallback
}

export function roughCutSourceFrames(source: RoughCutSourcePanel, fps = ROUGH_CUT_FPS) {
  return Math.max(1, Math.round((Math.max(1, source.durationMs) / 1_000) * fps))
}

export function createRoughCutClip(source: RoughCutSourcePanel, fps = ROUGH_CUT_FPS): VideoClip {
  const sourceDurationInFrames = roughCutSourceFrames(source, fps)
  return {
    id: `rough-cut:${source.panelId}`,
    src: source.videoUrl,
    durationInFrames: sourceDurationInFrames,
    trim: { from: 0, to: sourceDurationInFrames },
    metadata: {
      panelId: source.panelId,
      storyboardId: source.storyboardId,
      description: source.description || undefined,
      sceneLabel: source.sceneLabel,
      segmentLabel: source.segmentLabel,
      imageUrl: source.imageUrl,
      sourceDurationInFrames,
    },
  }
}

export function createRoughCutProject(
  episodeId: string,
  sources: RoughCutSourcePanel[],
  fps = ROUGH_CUT_FPS,
  dimensions: RoughCutDimensions = { width: 1080, height: 1920 },
): VideoEditorProject {
  return {
    id: `rough-cut:${episodeId}`,
    episodeId,
    schemaVersion: '1.0',
    config: { fps, width: dimensions.width, height: dimensions.height },
    timeline: sources.slice(0, MAX_ROUGH_CUT_CLIPS).map((source) => createRoughCutClip(source, fps)),
    bgmTrack: [],
  }
}

export function normalizeRoughCutProject(
  value: unknown,
  episodeId: string,
  sources: RoughCutSourcePanel[],
): VideoEditorProject | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  if (!Array.isArray(row.timeline)) return null
  if (typeof row.episodeId === 'string' && row.episodeId.trim() && row.episodeId.trim() !== episodeId) return null

  const rawConfig = row.config && typeof row.config === 'object' && !Array.isArray(row.config)
    ? row.config as Record<string, unknown>
    : {}
  const fps = clamp(finiteInteger(rawConfig.fps, ROUGH_CUT_FPS), 12, 60)
  const sourceMap = new Map(sources.map((source) => [source.panelId, source]))
  const seenClipIds = new Set<string>()
  const timeline: VideoClip[] = []

  for (const [index, rawClip] of row.timeline.slice(0, MAX_ROUGH_CUT_CLIPS).entries()) {
    if (!rawClip || typeof rawClip !== 'object' || Array.isArray(rawClip)) continue
    const clip = rawClip as Record<string, unknown>
    const metadata = clip.metadata && typeof clip.metadata === 'object' && !Array.isArray(clip.metadata)
      ? clip.metadata as Record<string, unknown>
      : {}
    const panelId = typeof metadata.panelId === 'string' ? metadata.panelId.trim() : ''
    const source = sourceMap.get(panelId)
    if (!source) continue

    const sourceDurationInFrames = roughCutSourceFrames(source, fps)
    const rawTrim = clip.trim && typeof clip.trim === 'object' && !Array.isArray(clip.trim)
      ? clip.trim as Record<string, unknown>
      : {}
    const from = clamp(finiteInteger(rawTrim.from, 0), 0, Math.max(0, sourceDurationInFrames - 1))
    const fallbackTo = from + Math.max(1, finiteInteger(clip.durationInFrames, sourceDurationInFrames - from))
    const to = clamp(finiteInteger(rawTrim.to, fallbackTo), from + 1, sourceDurationInFrames)

    const requestedClipId = cleanId(clip.id, `rough-cut:${panelId}:${index}`)
    const clipId = seenClipIds.has(requestedClipId) ? `rough-cut:${panelId}:${index}` : requestedClipId
    seenClipIds.add(clipId)
    const rawSourceAudio = clip.sourceAudio && typeof clip.sourceAudio === 'object' && !Array.isArray(clip.sourceAudio)
      ? clip.sourceAudio as Record<string, unknown>
      : null
    const requestedVolume = typeof rawSourceAudio?.volume === 'number'
      ? rawSourceAudio.volume
      : Number(rawSourceAudio?.volume ?? 1)
    const rawAudioSegments = Array.isArray(rawSourceAudio?.segments) ? rawSourceAudio.segments : null
    const clipDuration = to - from
    const audioSegmentIds = new Set<string>()
    const audioSegments = rawAudioSegments?.flatMap((value, segmentIndex) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return []
      const segment = value as Record<string, unknown>
      const segmentFrom = clamp(finiteInteger(segment.from, 0), 0, Math.max(0, clipDuration - 1))
      const segmentTo = clamp(finiteInteger(segment.to, clipDuration), segmentFrom + 1, clipDuration)
      const requestedId = cleanId(segment.id, `audio:${clipId}:${segmentIndex}`)
      const id = audioSegmentIds.has(requestedId) ? `audio:${clipId}:${segmentIndex}` : requestedId
      audioSegmentIds.add(id)
      const segmentVolume = typeof segment.volume === 'number' ? segment.volume : Number(segment.volume ?? 1)
      const hasTimelineStart = segment.timelineStartFrame !== undefined
        && Number.isFinite(typeof segment.timelineStartFrame === 'number' ? segment.timelineStartFrame : Number(segment.timelineStartFrame))
      return [{
        id,
        from: segmentFrom,
        to: segmentTo,
        volume: Number.isFinite(segmentVolume) ? clamp(segmentVolume, 0, 2) : 1,
        ...(hasTimelineStart ? { timelineStartFrame: Math.max(0, finiteInteger(segment.timelineStartFrame, 0)) } : {}),
      }]
    })
    const sourceAudio = rawSourceAudio?.detached === true
      ? {
        detached: true,
        volume: Number.isFinite(requestedVolume) ? clamp(requestedVolume, 0, 2) : 1,
        ...(rawAudioSegments ? { segments: audioSegments || [] } : {}),
      }
      : undefined
    timeline.push({
      id: clipId,
      src: source.videoUrl,
      durationInFrames: to - from,
      trim: { from, to },
      sourceAudio,
      // The assembly timeline uses exclusive frame ranges and hard cuts.
      // Legacy transition overlaps made both media streams active at a shot
      // boundary, which looked like replayed frames and made cut points
      // impossible to judge accurately.
      transition: undefined,
      metadata: {
        panelId,
        storyboardId: source.storyboardId,
        description: source.description || undefined,
        sceneLabel: source.sceneLabel,
        segmentLabel: source.segmentLabel,
        imageUrl: source.imageUrl,
        sourceDurationInFrames,
      },
    })
  }

  return {
    id: cleanId(row.id, `rough-cut:${episodeId}`),
    episodeId,
    schemaVersion: '1.0',
    config: {
      fps,
      width: clamp(finiteInteger(rawConfig.width, 1920), 320, 7680),
      height: clamp(finiteInteger(rawConfig.height, 1080), 320, 7680),
    },
    timeline,
    bgmTrack: [],
  }
}

export function parseRoughCutProject(
  serialized: string | null | undefined,
  episodeId: string,
  sources: RoughCutSourcePanel[],
) {
  if (!serialized?.trim()) return null
  try {
    return normalizeRoughCutProject(JSON.parse(serialized), episodeId, sources)
  } catch {
    return null
  }
}

export function roughCutClipRangeMs(clip: VideoClip, fps: number) {
  const from = clip.trim?.from ?? 0
  const to = clip.trim?.to ?? from + clip.durationInFrames
  return {
    trimStartMs: Math.round((from / fps) * 1_000),
    trimEndMs: Math.round((to / fps) * 1_000),
    durationMs: Math.max(1, Math.round(((to - from) / fps) * 1_000)),
  }
}
