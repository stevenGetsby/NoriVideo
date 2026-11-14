import { beatPlaybackRate } from '@/lib/interactive/playback'
import type { StoryBeatDuring } from '@/lib/interactive/types'

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
