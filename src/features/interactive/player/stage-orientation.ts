import type { StorySwipeDirection } from '@/lib/interactive/types'
import type { DirectionMapping } from './interaction-sessions'

/**
 * How far the whole stage is turned clockwise, in quarter turns. A 16:9 picture on a phone held upright is turned
 * once so it fills the screen (iOS cannot lock the screen to landscape).
 */
export type StageTurn = 0 | 1

const CLOCKWISE: readonly StorySwipeDirection[] = ['up', 'right', 'down', 'left']

/** Where a direction drawn in the picture ends up on screen; a swipe is judged on screen, so this maps authored → screen. */
export function turnDirection(direction: StorySwipeDirection, turn: StageTurn): StorySwipeDirection {
  return CLOCKWISE[(CLOCKWISE.indexOf(direction) + turn) % CLOCKWISE.length]
}

export const directionMapping = (turn: StageTurn): DirectionMapping => (direction) => turnDirection(direction, turn)

/** A pointer movement on screen expressed in the picture's own frame, for drawing inside the turned stage. */
export function unturnDelta(dx: number, dy: number, turn: StageTurn): { dx: number; dy: number } {
  return turn === 0 ? { dx, dy } : { dx: dy, dy: 0 - dx }
}

/** Phones only: wider screens have room for a 16:9 picture upright. */
export const TURN_MAX_WIDTH = 700

/** Turn a landscape work when the screen is a narrow, portrait one. */
export function stageTurnFor(landscapeWork: boolean, viewportWidth: number, viewportHeight: number): StageTurn {
  return landscapeWork && viewportHeight > viewportWidth && viewportWidth <= TURN_MAX_WIDTH ? 1 : 0
}

/** A phone held sideways (or a turned stage): too short for the header and side panel, so the player goes immersive. */
export const COMPACT_MAX_HEIGHT = 500

export function isCompactViewport(effectiveWidth: number, effectiveHeight: number): boolean {
  return effectiveWidth > effectiveHeight && effectiveHeight <= COMPACT_MAX_HEIGHT
}

/** The viewport as the player's layout sees it: width and height swap when the stage is turned. */
export function effectiveViewport(width: number, height: number, turn: StageTurn): { width: number; height: number } {
  return turn === 0 ? { width, height } : { width: height, height: width }
}
