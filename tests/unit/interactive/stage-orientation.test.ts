import { describe, expect, it } from 'vitest'
import { judgeSwipe, swipeDirectionOf } from '@/lib/interactive/interaction'
import { STORY_SWIPE_DIRECTIONS, type StorySwipeDirection } from '@/lib/interactive/types'
import { identityDirection, swipeMoveTo, swipeStart } from '@/features/interactive/player/interaction-sessions'
import {
  COMPACT_MAX_HEIGHT,
  TURN_MAX_WIDTH,
  directionMapping,
  effectiveViewport,
  isCompactViewport,
  stageTurnFor,
  turnDirection,
  unturnDelta,
} from '@/features/interactive/player/stage-orientation'

describe('where a picture direction lands on a turned screen', () => {
  it('leaves directions alone when the stage is not turned', () => {
    for (const direction of STORY_SWIPE_DIRECTIONS) {
      expect(turnDirection(direction, 0)).toBe(direction)
      expect(directionMapping(0)(direction)).toBe(identityDirection(direction))
    }
  })

  it('moves each direction a quarter turn clockwise: the picture top ends up on the screen right', () => {
    expect(turnDirection('up', 1)).toBe('right')
    expect(turnDirection('right', 1)).toBe('down')
    expect(turnDirection('down', 1)).toBe('left')
    expect(turnDirection('left', 1)).toBe('up')
  })

  it('stays a bijection, so two authored directions never share a screen direction', () => {
    expect(new Set(STORY_SWIPE_DIRECTIONS.map((direction) => turnDirection(direction, 1))).size).toBe(4)
  })
})

describe('a pointer movement seen from inside the turned picture', () => {
  it('is unchanged without a turn', () => {
    expect(unturnDelta(30, -12, 0)).toEqual({ dx: 30, dy: -12 })
  })

  it('reads a swipe to the screen right as an upward movement of the picture', () => {
    expect(unturnDelta(80, 0, 1)).toEqual({ dx: 0, dy: -80 })
    expect(unturnDelta(0, 80, 1)).toEqual({ dx: 80, dy: 0 })
    expect(unturnDelta(-80, 0, 1)).toEqual({ dx: 0, dy: 80 })
    expect(unturnDelta(0, -80, 1)).toEqual({ dx: -80, dy: 0 })
  })

  it('agrees with the direction mapping: the screen direction of a picture direction is that direction inside the picture', () => {
    const screenVector: Record<StorySwipeDirection, [number, number]> = { up: [0, -60], down: [0, 60], left: [-60, 0], right: [60, 0] }
    for (const authored of STORY_SWIPE_DIRECTIONS) {
      const [dx, dy] = screenVector[turnDirection(authored, 1)]
      const inPicture = unturnDelta(dx, dy, 1)
      expect(swipeDirectionOf(inPicture.dx, inPicture.dy), authored).toBe(authored)
    }
  })
})

describe('judging a swipe on a turned stage', () => {
  it('asks for the screen direction that matches the picture, not the authored one', () => {
    const start = swipeStart(200, 200)
    const mapping = directionMapping(1)
    // authored "up": on a turned stage the viewer has to swipe toward the screen right
    expect(swipeMoveTo(start, 300, 200, 'up', mapping).judgement).toBe('success')
    expect(swipeMoveTo(start, 200, 100, 'up', mapping).judgement).toBe('fail')
    expect(swipeMoveTo(start, 120, 200, 'up', mapping).judgement).toBe('fail')
    expect(swipeMoveTo(start, 215, 200, 'up', mapping).judgement).toBe('pending')
  })

  it('still judges upright stages by the authored direction', () => {
    const start = swipeStart(200, 200)
    expect(swipeMoveTo(start, 200, 100, 'up', directionMapping(0)).judgement).toBe('success')
    expect(judgeSwipe(0, -100, 'up')).toBe('success')
  })

  it('lets every authored direction succeed with exactly one screen swipe', () => {
    const start = swipeStart(0, 0)
    const mapping = directionMapping(1)
    const swipes: [number, number][] = [[90, 0], [-90, 0], [0, 90], [0, -90]]
    for (const authored of STORY_SWIPE_DIRECTIONS) {
      const passed = swipes.filter(([x, y]) => swipeMoveTo(start, x, y, authored, mapping).judgement === 'success')
      expect(passed, authored).toHaveLength(1)
    }
  })
})

describe('when the stage turns', () => {
  it('turns a 16:9 work on a phone held upright', () => {
    expect(stageTurnFor(true, 390, 844)).toBe(1)
    expect(stageTurnFor(true, TURN_MAX_WIDTH, TURN_MAX_WIDTH + 1)).toBe(1)
  })

  it('leaves everything else upright', () => {
    expect(stageTurnFor(false, 390, 844)).toBe(0)
    expect(stageTurnFor(true, 844, 390)).toBe(0)
    expect(stageTurnFor(true, 800, 1000)).toBe(0)
    expect(stageTurnFor(true, 600, 600)).toBe(0)
    expect(stageTurnFor(true, 1280, 720)).toBe(0)
  })
})

describe('compact viewports', () => {
  it('swaps width and height only for a turned stage', () => {
    expect(effectiveViewport(390, 844, 0)).toEqual({ width: 390, height: 844 })
    expect(effectiveViewport(390, 844, 1)).toEqual({ width: 844, height: 390 })
  })

  it('treats a short, wide viewport as a phone held sideways', () => {
    expect(isCompactViewport(844, 390)).toBe(true)
    expect(isCompactViewport(667, 375)).toBe(true)
    expect(isCompactViewport(900, COMPACT_MAX_HEIGHT)).toBe(true)
  })

  it('keeps upright phones, tablets and desktops on the full layout', () => {
    expect(isCompactViewport(390, 844)).toBe(false)
    expect(isCompactViewport(1024, 768)).toBe(false)
    expect(isCompactViewport(1440, 900)).toBe(false)
    expect(isCompactViewport(900, COMPACT_MAX_HEIGHT + 1)).toBe(false)
  })

  it('makes a turned phone compact, since the layout sees it sideways', () => {
    const turn = stageTurnFor(true, 390, 844)
    const view = effectiveViewport(390, 844, turn)
    expect(isCompactViewport(view.width, view.height)).toBe(true)
  })
})
