import { STORY_SLOW_RATE } from './interaction'
import { STORY_PLAYBACK_SPEEDS, type StoryBeatDuring, type StoryPlaybackConfig, type StoryPlaybackSpeed } from './types'

/** What a viewer can pick, always starting at 1x. A work without a playback config only offers 1x. */
export function playbackSpeeds(config: Pick<StoryPlaybackConfig, 'speeds'> | undefined): StoryPlaybackSpeed[] {
  const offered: readonly number[] = config?.speeds ?? []
  return STORY_PLAYBACK_SPEEDS.filter((speed) => speed === 1 || offered.includes(speed))
}

export const speedLabel = (speed: number): string => `${speed}x`

/** A remembered pick that is no longer on offer falls back to 1x. */
export const normalizeSpeed = (speed: number, speeds: readonly number[]): number => (speeds.includes(speed) ? speed : 1)

/** The speed the HUD button switches to; wraps back to 1x after the fastest. */
export function nextSpeed(speeds: readonly number[], current: number): number {
  const index = speeds.indexOf(current)
  return speeds[(index + 1) % speeds.length] ?? 1
}

/**
 * The picture's rate while an interaction is on screen. Interaction timers run on the wall clock, so the picture
 * plays at real pace there whatever speed the viewer picked; a faster picture would run a clip's tail out and end
 * the interaction early.
 */
export function beatPlaybackRate(during: StoryBeatDuring): number {
  if (during === 'freeze') return 0
  return during === 'slow' ? STORY_SLOW_RATE : 1
}
