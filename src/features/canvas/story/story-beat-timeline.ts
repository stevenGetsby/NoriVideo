import { STORY_BEAT_MAX_SEC, type BeatWindow } from '@/lib/interactive/interaction'
import type { StoryInteractionKind } from '@/lib/interactive/types'
import type { SceneBeat } from './story-beats'

/** Solid block colours per interaction kind; the scene timeline uses these. */
export const STORY_BEAT_COLORS: Record<StoryInteractionKind, string> = {
  tap: '#a3e635',
  swipe: '#38bdf8',
  timing: '#fbbf24',
  hold: '#f472b6',
  choice: '#a78bfa',
}

const EPS = 1e-6
const tenths = (value: number) => Math.round(value * 10) / 10

/** `5` / `5.5`, never `5.0`. */
export function formatBeatSecond(sec: number): string {
  const rounded = tenths(sec)
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}

/** `第 5–8 秒` */
export function beatRangeLabel(startSec: number, durationSec: number): string {
  return `第 ${formatBeatSecond(startSec)}–${formatBeatSecond(startSec + durationSec)} 秒`
}

export function beatTooltip(beat: Pick<SceneBeat, 'title' | 'startSec' | 'durationSec'>): string {
  return `${beat.title} · ${beatRangeLabel(beat.startSec, beat.durationSec)}`
}

export function beatChipLabel(beat: Pick<SceneBeat, 'title' | 'startSec'>): string {
  return `第 ${formatBeatSecond(beat.startSec)} 秒 · ${beat.title}`
}

/** Where a block sits on a 0..1 track; a window running past the end is cut at the end. */
export function beatTrackFractions(startSec: number, durationSec: number, videoDurationSec: number | null | undefined): { left: number; width: number } {
  const total = videoDurationSec && videoDurationSec > 0 ? videoDurationSec : 0
  if (!total) return { left: 0, width: 0 }
  const left = Math.min(1, Math.max(0, startSec / total))
  const width = Math.max(0, Math.min(durationSec / total, 1 - left))
  return { left, width }
}

/** Seconds a pointer drag of `deltaPx` covers on a track of `trackWidthPx` across the video. */
export function beatDragSeconds(deltaPx: number, trackWidthPx: number, videoDurationSec: number): number {
  if (!(trackWidthPx > 0) || !(videoDurationSec > 0)) return 0
  return (deltaPx / trackWidthPx) * videoDurationSec
}

const overlaps = (startSec: number, durationSec: number, window: BeatWindow) =>
  startSec + EPS < window.startSec + window.durationSec && window.startSec + EPS < startSec + durationSec

/**
 * Drag resolution: the dragged window stays inside the video and never overlaps another beat.
 * It snaps against the neighbour's edge on the side the drag came from (`fallbackStart` is where
 * the window started this gesture); when there is no room at all it keeps the fallback position.
 */
export function resolveBeatStart(
  proposedStart: number,
  durationSec: number,
  others: readonly BeatWindow[],
  videoDurationSec: number | null | undefined,
  fallbackStart?: number,
): number {
  const duration = Math.max(0.1, tenths(durationSec))
  const latest = videoDurationSec && videoDurationSec > 0
    ? Math.max(0, videoDurationSec - duration)
    : Math.max(0, STORY_BEAT_MAX_SEC - duration)
  const clamp = (value: number) => tenths(Math.min(latest, Math.max(0, value)))
  const blocked = (start: number) => others.some((window) => window.durationSec > 0 && overlaps(start, duration, window))
  const proposed = clamp(proposedStart)
  if (!blocked(proposed)) return proposed

  const fallbackValid = fallbackStart !== undefined && !blocked(clamp(fallbackStart))
  const preferred: number[] = []
  const alternate: number[] = []
  for (const window of others) {
    if (window.durationSec <= 0 || !overlaps(proposed, duration, window)) continue
    const before = window.startSec - duration
    const after = window.startSec + window.durationSec
    let side: 'before' | 'after' | null = null
    if (fallbackStart !== undefined) {
      const anchor = fallbackStart
      if (anchor + duration <= window.startSec + EPS) side = 'before'
      else if (anchor >= window.startSec + window.durationSec - EPS) side = 'after'
    }
    if (!side) side = Math.abs(proposed - after) <= Math.abs(proposed - before) ? 'after' : 'before'
    preferred.push(side === 'before' ? before : after)
    alternate.push(side === 'before' ? after : before)
  }

  const usable = (candidate: number) => candidate >= -EPS && candidate <= latest + EPS && !blocked(clamp(candidate))
  const snap = preferred.find(usable) ?? alternate.find(usable)
  if (snap !== undefined) return clamp(snap)
  if (fallbackValid && fallbackStart !== undefined) return clamp(fallbackStart)
  return clamp(proposed)
}
