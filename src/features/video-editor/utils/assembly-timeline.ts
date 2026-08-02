import type { ComputedClip, SourceAudioSegment } from '../types/editor.types'

export const ASSEMBLY_TRACK_INLINE_PADDING = 7
export const ASSEMBLY_TRACK_CLIP_GAP = 3

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
