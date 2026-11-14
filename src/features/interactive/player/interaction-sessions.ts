import {
  holdProgress,
  judgeHold,
  judgeSwipe,
  judgeTap,
  judgeTiming,
  timingPointer,
  STORY_INTERACTION_DEFAULT_HINT,
  type HoldJudgement,
  type SwipeJudgement,
  type TimingJudgement,
} from '@/lib/interactive/interaction'
import type { StoryInteractionNode, StoryInteractionSpec, StorySwipeDirection } from '@/lib/interactive/types'

type TapSpec = Extract<StoryInteractionSpec, { type: 'tap' }>
type TimingSpec = Extract<StoryInteractionSpec, { type: 'timing' }>
type HoldSpec = Extract<StoryInteractionSpec, { type: 'hold' }>

/* ---------- 快速点击 ---------- */

export interface TapSession {
  taps: number
}

export const initialTapSession: TapSession = { taps: 0 }

export function registerTap(session: TapSession): TapSession {
  return { taps: session.taps + 1 }
}

export function tapPercent(session: TapSession, spec: TapSpec): number {
  return Math.min(100, (session.taps / Math.max(1, spec.count)) * 100)
}

/** The handle the taps resolve to, or null while the viewer still has taps to go. */
export function tapHandle(session: TapSession, spec: TapSpec): 'success' | null {
  return judgeTap(session.taps, spec.count) === 'success' ? 'success' : null
}

/* ---------- 时机点击 ---------- */

export interface TimingFrame {
  /** 0..1 across the bar, ping-ponging. */
  position: number
  percent: number
}

export function timingFrameAt(startedAtMs: number, nowMs: number, spec: TimingSpec): TimingFrame {
  const position = timingPointer(Math.max(0, nowMs - startedAtMs) / 1000, spec.speed)
  return { position, percent: position * 100 }
}

export function timingTapAt(startedAtMs: number, nowMs: number, spec: TimingSpec): TimingJudgement {
  return judgeTimingFrame(timingFrameAt(startedAtMs, nowMs, spec), spec)
}

/** Judgement for a known pointer position, kept separate so the boundaries stay testable. */
export function judgeTimingFrame(frame: Pick<TimingFrame, 'position'>, spec: Pick<TimingSpec, 'perfectWidth' | 'normalWidth'>): TimingJudgement {
  return judgeTiming(frame.position, spec.perfectWidth, spec.normalWidth)
}

/* ---------- 长按蓄力 ---------- */

export interface HoldSession {
  holding: boolean
  pressStartMs: number | null
}

export const initialHoldSession: HoldSession = { holding: false, pressStartMs: null }

export function holdStart(nowMs: number): HoldSession {
  return { holding: true, pressStartMs: nowMs }
}

export function holdStop(): HoldSession {
  return initialHoldSession
}

export function heldSecOf(session: HoldSession, nowMs: number): number {
  if (!session.holding || session.pressStartMs === null) return 0
  return Math.max(0, nowMs - session.pressStartMs) / 1000
}

export interface HoldFrame {
  heldSec: number
  percent: number
  overcharged: boolean
}

export function holdFrameAt(session: HoldSession, nowMs: number, spec: HoldSpec): HoldFrame {
  const heldSec = heldSecOf(session, nowMs)
  const { percent, overcharged } = holdProgress(heldSec, spec.fillSec, spec.overchargeFails)
  return { heldSec, percent, overcharged }
}

export function holdRelease(session: HoldSession, nowMs: number, spec: HoldSpec): { judgement: HoldJudgement; heldSec: number } {
  const heldSec = heldSecOf(session, nowMs)
  return { judgement: judgeHold(heldSec, spec), heldSec }
}

/** The real-time limit ran out: judge what was actually held, or fail when nobody pressed. */
export function holdTimeout(session: HoldSession, nowMs: number, spec: HoldSpec): HoldJudgement {
  if (!session.holding || session.pressStartMs === null) return 'fail'
  return judgeHold(heldSecOf(session, nowMs), spec)
}

/* ---------- 方向滑动 ---------- */

export type DirectionMapping = (direction: StorySwipeDirection) => StorySwipeDirection
export const identityDirection: DirectionMapping = (direction) => direction

export interface SwipeSession {
  active: boolean
  startX: number
  startY: number
  x: number
  y: number
}

export const SWIPE_MIN_DISTANCE = 40

export function swipeStart(x: number, y: number): SwipeSession {
  return { active: true, startX: x, startY: y, x, y }
}

export function swipeDeltaOf(session: SwipeSession): { dx: number; dy: number } {
  return { dx: session.x - session.startX, dy: session.y - session.startY }
}

export interface SwipeMove {
  session: SwipeSession
  judgement: SwipeJudgement
  dx: number
  dy: number
}

export function swipeMoveTo(
  session: SwipeSession,
  x: number,
  y: number,
  direction: StorySwipeDirection,
  mapDirection: DirectionMapping = identityDirection,
  minDistance = SWIPE_MIN_DISTANCE,
): SwipeMove {
  const dx = x - session.startX
  const dy = y - session.startY
  return {
    session: { ...session, x, y },
    judgement: judgeSwipe(dx, dy, mapDirection(direction), minDistance),
    dx,
    dy,
  }
}

/* ---------- copy ---------- */

/** What the overlay tells the viewer to do; falls back to the per-kind default hint. */
export function beatHint(node: Pick<StoryInteractionNode, 'hint' | 'spec'>): string {
  return node.hint.trim() || STORY_INTERACTION_DEFAULT_HINT[node.spec.type]
}
