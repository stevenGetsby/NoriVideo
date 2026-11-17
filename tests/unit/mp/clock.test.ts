import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PausableClock, VIDEO_TICK_MS, VideoClock } from '../../../miniprogram/miniprogram/pkg-play/lib/clock'

describe('PausableClock', () => {
  it('follows the injected wall clock while running', () => {
    let t = 1000
    const clock = new PausableClock(() => t)
    expect(clock.now()).toBe(1000)
    expect(clock.isPaused()).toBe(false)
    t = 2500
    expect(clock.now()).toBe(2500)
  })

  it('freezes at the pause instant and subtracts the paused span on resume', () => {
    let t = 0
    const clock = new PausableClock(() => t)
    t = 1000
    clock.pause()
    t = 4000
    expect(clock.isPaused()).toBe(true)
    expect(clock.now()).toBe(1000)
    clock.resume()
    expect(clock.isPaused()).toBe(false)
    expect(clock.now()).toBe(1000)
    t = 5000
    expect(clock.now()).toBe(2000)
  })

  it('nests pauses so only the outermost resume runs the clock again', () => {
    let t = 0
    const clock = new PausableClock(() => t)
    t = 100
    clock.pause()
    clock.pause()
    t = 500
    clock.resume()
    expect(clock.isPaused()).toBe(true)
    expect(clock.now()).toBe(100)
    t = 900
    clock.resume()
    expect(clock.isPaused()).toBe(false)
    expect(clock.now()).toBe(100)
    t = 1000
    expect(clock.now()).toBe(200)
  })

  it('resume without a pause is a no-op', () => {
    let t = 5
    const clock = new PausableClock(() => t)
    clock.resume()
    expect(clock.now()).toBe(5)
    expect(clock.isPaused()).toBe(false)
  })
})

describe('VideoClock position', () => {
  it('ticks every 50ms', () => {
    expect(VIDEO_TICK_MS).toBe(50)
  })

  it('extrapolates from the timeupdate anchor at the current rate', () => {
    let t = 0
    const clock = new VideoClock(() => t)
    clock.update(10, 60)
    expect(clock.duration).toBe(60)
    t = 2000
    expect(clock.position()).toBeCloseTo(12, 5)
  })

  it('clamps the estimate to [0, duration]', () => {
    let t = 0
    const clock = new VideoClock(() => t)
    clock.update(58, 60)
    t = 10000
    expect(clock.position()).toBe(60)
    clock.seek(-5)
    expect(clock.position()).toBe(0)
  })

  it('pause stops extrapolation and resume re-anchors', () => {
    let t = 0
    const clock = new VideoClock(() => t)
    clock.update(10, 60)
    t = 1000
    clock.pause()
    expect(clock.position()).toBeCloseTo(11, 5)
    t = 5000
    expect(clock.position()).toBeCloseTo(11, 5)
    clock.resume()
    t = 6000
    expect(clock.position()).toBeCloseTo(12, 5)
  })

  it('seek resets the anchor and stops extrapolation', () => {
    let t = 0
    const clock = new VideoClock(() => t)
    clock.update(10, 60)
    clock.seek(3)
    t = 5000
    expect(clock.position()).toBe(3)
  })

  it('setRate re-anchors so the position stays continuous', () => {
    let t = 0
    const clock = new VideoClock(() => t)
    clock.update(0, 60)
    t = 2000
    clock.setRate(2)
    expect(clock.position()).toBeCloseTo(2, 5)
    t = 3000
    expect(clock.position()).toBeCloseTo(4, 5)
  })

  it('ended pins the position to the duration', () => {
    let t = 0
    const clock = new VideoClock(() => t)
    clock.update(10, 60)
    clock.ended()
    t = 9000
    expect(clock.position()).toBe(60)
  })

  it('reset clears the anchor and adopts the new duration', () => {
    let t = 0
    const clock = new VideoClock(() => t)
    clock.update(10, 60)
    clock.reset(30)
    expect(clock.position()).toBe(0)
    expect(clock.duration).toBe(30)
    clock.reset()
    expect(clock.duration).toBe(0)
  })

  it('without a duration the estimate is unbounded above', () => {
    let t = 0
    const clock = new VideoClock(() => t)
    clock.update(10, 0)
    t = 5000
    expect(clock.position()).toBeCloseTo(15, 5)
  })
})

describe('VideoClock tick interval', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
  })
  afterEach(() => vi.useRealTimers())

  it('fires onTick every 50ms while started and stops on stop', () => {
    const onTick = vi.fn()
    const clock = new VideoClock(() => Date.now(), onTick)
    expect(clock.ticking).toBe(false)
    clock.start()
    expect(clock.ticking).toBe(true)
    vi.advanceTimersByTime(150)
    expect(onTick).toHaveBeenCalledTimes(3)
    clock.stop()
    expect(clock.ticking).toBe(false)
    vi.advanceTimersByTime(200)
    expect(onTick).toHaveBeenCalledTimes(3)
  })

  it('start is idempotent', () => {
    const onTick = vi.fn()
    const clock = new VideoClock(() => Date.now(), onTick)
    clock.start()
    clock.start()
    vi.advanceTimersByTime(50)
    expect(onTick).toHaveBeenCalledTimes(1)
    clock.stop()
  })
})
