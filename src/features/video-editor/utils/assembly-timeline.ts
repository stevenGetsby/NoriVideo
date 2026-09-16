import type { ComputedClip, SourceAudioSegment } from '../types/editor.types'

export const ASSEMBLY_TRACK_INLINE_PADDING = 7
export const ASSEMBLY_TRACK_CLIP_GAP = 3
export const ASSEMBLY_MIN_CLIP_PX = 28
export const ASSEMBLY_BASE_PX_PER_SECOND = 52
export const ASSEMBLY_RULER_LABEL_GAP = 76
export const ASSEMBLY_RULER_NICE_SECONDS = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600] as const

function clipContentWidth(widths: number[]) {
  if (!widths.length) return 0
  return widths.reduce((sum, width) => sum + width, 0)
    + Math.max(0, widths.length - 1) * ASSEMBLY_TRACK_CLIP_GAP
    + ASSEMBLY_TRACK_INLINE_PADDING * 2
}

export function assemblyClipWidths({
  durations,
  fps,
  zoom,
  fitTrackWidth,
}: {
  durations: number[]
  fps: number
  zoom: number
  fitTrackWidth: number
}) {
  const safeFps = Math.max(1, fps)
  const totalFrames = durations.reduce((sum, duration) => sum + Math.max(0, duration), 0)
  const gaps = ASSEMBLY_TRACK_INLINE_PADDING * 2 + Math.max(0, durations.length - 1) * ASSEMBLY_TRACK_CLIP_GAP
  const usableFit = Math.max(0, fitTrackWidth - gaps)
  const naturalPxPerFrame = (ASSEMBLY_BASE_PX_PER_SECOND / safeFps) * Math.max(0.1, zoom)
  const fitPxPerFrame = totalFrames > 0 ? usableFit / totalFrames : 0
  const pxPerFrame = Math.max(naturalPxPerFrame, fitPxPerFrame)
  return durations.map((duration) => Math.max(ASSEMBLY_MIN_CLIP_PX, Math.max(0, duration) * pxPerFrame))
}

export function assemblyTimelineWidth(widths: number[], minimum: number) {
  return Math.max(minimum, clipContentWidth(widths))
}

export function assemblyRulerFrames(totalFrames: number, fps: number, trackWidth: number) {
  if (totalFrames <= 0) return [0]
  const safeFps = Math.max(1, fps)
  const maxTicks = Math.max(2, Math.floor(Math.max(trackWidth, 1) / ASSEMBLY_RULER_LABEL_GAP) + 1)
  const durationSec = totalFrames / safeFps
  const stepSec = ASSEMBLY_RULER_NICE_SECONDS.find((candidate) => durationSec / candidate + 1 <= maxTicks)
    ?? ASSEMBLY_RULER_NICE_SECONDS[ASSEMBLY_RULER_NICE_SECONDS.length - 1]
  const stepFrames = Math.max(1, Math.round(stepSec * safeFps))
  const frames: number[] = []
  for (let frame = 0; frame < totalFrames; frame += stepFrames) frames.push(frame)
  if (frames[frames.length - 1] !== totalFrames) frames.push(totalFrames)
  return frames
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value))
}

export function clientXToCssOffset(
  clientX: number,
  rectLeft: number,
  rectWidth: number,
  logicalWidth: number,
) {
  const screenScale = logicalWidth > 0 ? rectWidth / logicalWidth : 1
  return (clientX - rectLeft) / (Number.isFinite(screenScale) && screenScale > 0 ? screenScale : 1)
}

export function sourceAudioTimelineStart(clipStartFrame: number, segment: SourceAudioSegment) {
  return Number.isFinite(segment.timelineStartFrame)
    ? Math.max(0, Math.round(segment.timelineStartFrame!))
    : clipStartFrame + segment.from
}

export function timelineFrameToOffset(
  frame: number,
  positions: ComputedClip[],
  widths: number[],
  preferredClipId?: string | null,
) {
  if (!positions.length) return ASSEMBLY_TRACK_INLINE_PADDING
  const totalFrames = positions.at(-1)?.endFrame || 0
  const target = clamp(Math.round(frame), 0, totalFrames)
  const preferredIndex = preferredClipId ? positions.findIndex((clip) => clip.id === preferredClipId) : -1
  if (preferredIndex >= 0) {
    const preferred = positions[preferredIndex]
    if (target >= preferred.startFrame && target <= preferred.endFrame) {
      const start = visualClipStartOffset(preferredIndex, widths)
      const progress = clamp((target - preferred.startFrame) / Math.max(1, preferred.durationInFrames), 0, 1)
      return start + (widths[preferredIndex] || 0) * progress
    }
  }
  let offset = ASSEMBLY_TRACK_INLINE_PADDING
  for (let index = 0; index < positions.length; index += 1) {
    const clip = positions[index]
    const width = widths[index] || 0
    if (target <= clip.endFrame || index === positions.length - 1) {
      const progress = clamp((target - clip.startFrame) / Math.max(1, clip.durationInFrames), 0, 1)
      return offset + width * progress
    }
    offset += width + ASSEMBLY_TRACK_CLIP_GAP
  }
  return offset
}

export function visualClipStartOffset(index: number, widths: number[]) {
  const safeIndex = Math.max(0, Math.min(widths.length, Math.floor(index)))
  return ASSEMBLY_TRACK_INLINE_PADDING + widths.slice(0, safeIndex).reduce((sum, width) => sum + width + ASSEMBLY_TRACK_CLIP_GAP, 0)
}

export function timelineOffsetToLocation(
  offset: number,
  positions: ComputedClip[],
  widths: number[],
): { frame: number; clipId: string | null } {
  if (!positions.length) return { frame: 0, clipId: null }
  let cursor = ASSEMBLY_TRACK_INLINE_PADDING
  const target = Math.max(ASSEMBLY_TRACK_INLINE_PADDING, offset)
  for (let index = 0; index < positions.length; index += 1) {
    const clip = positions[index]
    const width = widths[index] || 0
    const clipEnd = cursor + width
    if (target <= clipEnd || index === positions.length - 1) {
      const progress = clamp((target - cursor) / Math.max(1, width), 0, 1)
      return { frame: Math.round(clip.startFrame + clip.durationInFrames * progress), clipId: clip.id }
    }
    if (target < clipEnd + ASSEMBLY_TRACK_CLIP_GAP) return { frame: clip.endFrame, clipId: clip.id }
    cursor = clipEnd + ASSEMBLY_TRACK_CLIP_GAP
  }
  const last = positions.at(-1)!
  return { frame: last.endFrame, clipId: last.id }
}

export function timelineOffsetToFrame(
  offset: number,
  positions: ComputedClip[],
  widths: number[],
) {
  return timelineOffsetToLocation(offset, positions, widths).frame
}
