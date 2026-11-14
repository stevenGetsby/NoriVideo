import type { BeatOutcome, StoryRun, StoryStop } from '@/lib/interactive/engine'
import type { StoryInteractionNode } from '@/lib/interactive/types'

export type FiredBeats = ReadonlySet<string>
export const NO_FIRED_BEATS: FiredBeats = new Set<string>()

/** Adds one interaction to the "already shown" set of the current scene. */
export function markBeatFired(fired: FiredBeats, beatId: string): Set<string> {
  const next = new Set(fired)
  next.add(beatId)
  return next
}

/**
 * After a rewind every interaction that starts at or after the seek point can fire again.
 * The retried interaction always starts after `startSec - 2`, so it re-arms together with
 * anything the rewind pushed past.
 */
export function unfireBeatsFrom(fired: FiredBeats, beats: readonly StoryInteractionNode[], seekSec: number): Set<string> {
  const next = new Set(fired)
  for (const beat of beats) {
    if (beat.startSec >= seekSec) next.delete(beat.id)
  }
  return next
}

/** Everything the stage needs after one interaction result has been settled by the engine. */
export interface BeatPlan {
  kind: BeatOutcome['kind']
  run: StoryRun
  fired: Set<string>
  /** Set on a retry: the video rewinds here before the interaction can fire again. */
  seekSec: number | null
  /** Set on a deferred cut: the chip shown until the segment finishes. */
  pendingLabel: string | null
}

export function applyBeatOutcome(
  outcome: BeatOutcome,
  beat: StoryInteractionNode,
  beats: readonly StoryInteractionNode[],
  fired: FiredBeats,
): BeatPlan {
  if (outcome.kind === 'retry') {
    return {
      kind: 'retry',
      run: outcome.run,
      fired: unfireBeatsFrom(fired, beats, outcome.seekSec),
      seekSec: outcome.seekSec,
      pendingLabel: null,
    }
  }
  if (outcome.kind === 'cut') {
    return { kind: 'cut', run: outcome.run, fired: markBeatFired(fired, beat.id), seekSec: null, pendingLabel: null }
  }
  return {
    kind: outcome.kind,
    run: outcome.run,
    fired: markBeatFired(fired, beat.id),
    seekSec: null,
    pendingLabel: outcome.kind === 'defer' ? outcome.run.pending?.label ?? '' : null,
  }
}

/** What to do with the plan once the video has ended: cut away now, move on, or rewind. */
export type BeatEndAction = 'settle' | 'advance' | 'retry'
export function beatEndAction(plan: BeatPlan): BeatEndAction {
  if (plan.kind === 'cut') return 'settle'
  if (plan.kind === 'retry') return 'retry'
  return 'advance'
}

/** Real-time countdown maths. Interaction limits never follow the video's playbackRate. */
export function elapsedSec(startedAtMs: number, nowMs: number): number {
  return Math.max(0, nowMs - startedAtMs) / 1000
}

export function remainingSec(startedAtMs: number, nowMs: number, durationSec: number): number {
  return Math.max(0, durationSec - elapsedSec(startedAtMs, nowMs))
}

export function countdownPercent(startedAtMs: number, nowMs: number, durationSec: number): number {
  if (durationSec <= 0) return 0
  return Math.min(100, (remainingSec(startedAtMs, nowMs, durationSec) / durationSec) * 100)
}

export function isCountdownExpired(startedAtMs: number, nowMs: number, durationSec: number): boolean {
  return remainingSec(startedAtMs, nowMs, durationSec) <= 0
}

export type ResolutionGate<T> = (value: T) => boolean

/**
 * The first result wins; a timer and a pointer event can never both resolve the same
 * interaction. Returns whether the value went through.
 */
export function createResolutionGate<T>(resolve: (value: T) => void): ResolutionGate<T> {
  let used = false
  return (value: T) => {
    if (used) return false
    used = true
    resolve(value)
    return true
  }
}

/**
 * A standalone interaction that fails with 失败重来 is settled as the same stop object;
 * that is the cue to re-arm the overlay with a fresh attempt number.
 */
export function nextAttempt(attempt: number, previousStop: StoryStop, next: StoryRun): number {
  return next.stop === previousStop ? attempt + 1 : 0
}
