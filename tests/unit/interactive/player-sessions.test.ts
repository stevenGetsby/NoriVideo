import { describe, expect, it } from 'vitest'
import {
  holdFrameAt,
  holdRelease,
  holdStart,
  holdTimeout,
  initialHoldSession,
  initialTapSession,
  judgeTimingFrame,
  registerTap,
  swipeDeltaOf,
  swipeMoveTo,
  swipeStart,
  tapHandle,
  tapPercent,
  timingFrameAt,
  timingTapAt,
  type DirectionMapping,
} from '@/features/interactive/player/interaction-sessions'
import type { StoryInteractionSpec } from '@/lib/interactive/types'

const tapSpec: Extract<StoryInteractionSpec, { type: 'tap' }> = { type: 'tap', count: 4, buttonText: '', buttonImageUrl: null }
const timingSpec: Extract<StoryInteractionSpec, { type: 'timing' }> = { type: 'timing', propImageUrl: null, speed: 1, perfectWidth: 20, normalWidth: 40 }
const holdSpec: Extract<StoryInteractionSpec, { type: 'hold' }> = { type: 'hold', fillSec: 2, rangeMin: 80, rangeMax: 100, overchargeFails: true, buttonText: '', buttonImageUrl: null }

describe('快速点击 session', () => {
  it('collects taps one pointerdown at a time and resolves at the count', () => {
    let session = initialTapSession
    expect(tapHandle(session, tapSpec)).toBeNull()
    for (let index = 0; index < 3; index += 1) session = registerTap(session)
    expect(session.taps).toBe(3)
    expect(tapPercent(session, tapSpec)).toBe(75)
    expect(tapHandle(session, tapSpec)).toBeNull()
    session = registerTap(session)
    expect(tapHandle(session, tapSpec)).toBe('success')
    expect(tapPercent(session, tapSpec)).toBe(100)
    expect(tapPercent(registerTap(session), tapSpec)).toBe(100)
  })
})

describe('时机点击 session', () => {
  it('sweeps ping-pong and judges perfect / normal / miss', () => {
    expect(timingFrameAt(0, 500, timingSpec)).toMatchObject({ position: 0.5, percent: 50 })
    expect(timingTapAt(0, 500, timingSpec)).toBe('perfect')
    expect(timingTapAt(0, 350, timingSpec)).toBe('normal')
    expect(timingTapAt(0, 250, timingSpec)).toBe('miss')
    // Halfway through the return sweep the pointer is centred again.
    expect(timingTapAt(0, 1500, timingSpec)).toBe('perfect')
    // The frame position is clamped forward: time never runs backwards.
    expect(timingFrameAt(0, -100, timingSpec).position).toBe(0)
  })

  it('keeps the zones at the exact boundaries of the configured widths', () => {
    const spec = { perfectWidth: 20, normalWidth: 40 }
    expect(judgeTimingFrame({ position: 0.5 }, spec)).toBe('perfect')
    expect(judgeTimingFrame({ position: 0.402 }, spec)).toBe('perfect')
    expect(judgeTimingFrame({ position: 0.398 }, spec)).toBe('normal')
    expect(judgeTimingFrame({ position: 0.302 }, spec)).toBe('normal')
    expect(judgeTimingFrame({ position: 0.298 }, spec)).toBe('miss')
    expect(judgeTimingFrame({ position: 0.698 }, spec)).toBe('normal')
    expect(judgeTimingFrame({ position: 0.702 }, spec)).toBe('miss')
    expect(judgeTimingFrame({ position: 0.698 }, { perfectWidth: 10, normalWidth: 10 })).toBe('miss')
  })
})

describe('长按蓄力 session', () => {
  it('fills in real time and judges the release inside the success band', () => {
    const session = holdStart(1000)
    expect(holdFrameAt(session, 1800, holdSpec)).toMatchObject({ heldSec: 0.8, percent: 40, overcharged: false })
    expect(holdFrameAt(session, 2900, holdSpec).percent).toBe(95)
    expect(holdRelease(session, 2900, holdSpec)).toEqual({ judgement: 'success', heldSec: 1.9 })
    expect(holdRelease(session, 1400, holdSpec).judgement).toBe('fail')
    expect(holdTimeout(initialHoldSession, 5000, holdSpec)).toBe('fail')
  })

  it('fails the moment the fill overshoots while the finger is still down', () => {
    const session = holdStart(1000)
    expect(holdFrameAt(session, 2900, holdSpec).overcharged).toBe(false)
    const overshoot = holdFrameAt(session, 3100, holdSpec)
    expect(overshoot.overcharged).toBe(true)
    expect(overshoot.percent).toBe(100)
    expect(holdRelease(session, 3100, holdSpec).judgement).toBe('fail')
    // Without 超额失败 the same hold is a success at the top of the band.
    const relaxed = { ...holdSpec, overchargeFails: false }
    expect(holdFrameAt(session, 3100, relaxed).overcharged).toBe(false)
    expect(holdRelease(session, 3100, relaxed).judgement).toBe('success')
  })

  it('judges the held time when the real-time limit fires while still holding', () => {
    const session = holdStart(1000)
    expect(holdTimeout(session, 2800, holdSpec)).toBe('success')
    expect(holdTimeout(session, 1200, holdSpec)).toBe('fail')
    expect(holdTimeout(session, 3200, holdSpec)).toBe('fail')
  })
})

describe('方向滑动 session', () => {
  it('stays pending until the drag is decisive, then accepts the requested direction', () => {
    const session = swipeStart(100, 100)
    expect(swipeMoveTo(session, 110, 104, 'up').judgement).toBe('pending')
    const up = swipeMoveTo(session, 100, 40, 'up')
    expect(up.judgement).toBe('success')
    expect(swipeDeltaOf(up.session)).toEqual({ dx: 0, dy: -60 })
  })

  it('fails the wrong direction and the wrong axis', () => {
    const session = swipeStart(100, 100)
    expect(swipeMoveTo(session, 100, 160, 'up').judgement).toBe('fail')
    expect(swipeMoveTo(session, 40, 100, 'up').judgement).toBe('fail')
    expect(swipeMoveTo(session, 160, 100, 'right').judgement).toBe('success')
  })

  it('honours a direction remap for rotated screens', () => {
    const session = swipeStart(100, 100)
    const swapUpDown: DirectionMapping = (direction) => (direction === 'up' ? 'down' : direction === 'down' ? 'up' : direction)
    expect(swipeMoveTo(session, 100, 40, 'up').judgement).toBe('success')
    expect(swipeMoveTo(session, 100, 40, 'up', swapUpDown).judgement).toBe('fail')
    expect(swipeMoveTo(session, 100, 160, 'up', swapUpDown).judgement).toBe('success')
  })
})
