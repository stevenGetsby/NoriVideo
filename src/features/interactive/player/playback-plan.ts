import { beatPlaybackRate } from '@/lib/interactive/playback'
import type { StoryBeatDuring, StoryInteractionNode, StoryMedia } from '@/lib/interactive/types'

export interface PictureState {
  /** What the media element's playbackRate should be. */
  rate: number
  /** False for 画面定格 and while a sheet covers the stage. */
  playing: boolean
}

/**
 * The picture's pace at this moment. Between interactions the viewer's speed rules everywhere,
 * including scenes without beats and right after a speed switch. Inside one the picture runs at
 * real pace (or the fixed slow rate) because the interaction timers use the wall clock: a faster
 * picture would run a clip's tail out and end the interaction early.
 */
export function pictureState(baseRate: number, during: StoryBeatDuring | null, sheetPaused: boolean): PictureState {
  if (during === 'freeze') return { rate: 1, playing: false }
  return { rate: during === null ? baseRate : beatPlaybackRate(during), playing: !sheetPaused }
}

/** 独立互动的底图：自己的画面 → 上一段最后一帧 → 无。 */
export function standaloneBackdrop(node: StoryInteractionNode, previous: StoryMedia | null): { media: StoryMedia | null; freeze: boolean } {
  if (node.picture) return { media: node.picture, freeze: false }
  if (previous) return { media: previous, freeze: true }
  return { media: null, freeze: true }
}

/** 把视频停在最后一帧：抉择底图与「上一段最后一帧」回退共用，绝不回到第 0 秒重播。 */
export function seekToLastFrame(video: HTMLVideoElement | null): void {
  if (!video) return
  if (Number.isFinite(video.duration) && video.duration > 0) {
    try { video.currentTime = Math.max(0, video.duration - 0.04) } catch { /* metadata not ready */ }
  }
  video.pause()
}
