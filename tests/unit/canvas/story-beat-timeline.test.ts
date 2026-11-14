import { describe, expect, it } from 'vitest'
import {
  beatChipLabel,
  beatDragSeconds,
  beatRangeLabel,
  beatTooltip,
  beatTrackFractions,
  formatBeatSecond,
  resolveBeatStart,
} from '@/features/canvas/story/story-beat-timeline'

const window = (startSec: number, durationSec: number) => ({ startSec, durationSec })

describe('timeline labels', () => {
  it('formats seconds without trailing zeros', () => {
    expect(formatBeatSecond(5)).toBe('5')
    expect(formatBeatSecond(5.04)).toBe('5')
    expect(formatBeatSecond(5.5)).toBe('5.5')
    expect(formatBeatSecond(0)).toBe('0')
  })

  it('describes a block as a range', () => {
    expect(beatRangeLabel(5, 3)).toBe('第 5–8 秒')
    expect(beatRangeLabel(57.5, 2.5)).toBe('第 57.5–60 秒')
  })

  it('labels the block tooltip and the unknown-length chip', () => {
    const beat = { title: '电梯连点', startSec: 57, durationSec: 3 }
    expect(beatTooltip(beat)).toBe('电梯连点 · 第 57–60 秒')
    expect(beatChipLabel(beat)).toBe('第 57 秒 · 电梯连点')
  })
})

describe('timeline geometry', () => {
  it('maps a window onto 0..1', () => {
    expect(beatTrackFractions(15, 3, 60)).toEqual({ left: 0.25, width: 0.05 })
  })

  it('cuts a window running past the video end at the end', () => {
    const fractions = beatTrackFractions(58, 5, 60)
    expect(fractions.left).toBeCloseTo(58 / 60)
    expect(fractions.width).toBeCloseTo(2 / 60)
  })

  it('renders nothing without a video length', () => {
    expect(beatTrackFractions(5, 3, null)).toEqual({ left: 0, width: 0 })
  })

  it('converts pointer pixels to seconds', () => {
    expect(beatDragSeconds(30, 300, 60)).toBe(6)
    expect(beatDragSeconds(30, 0, 60)).toBe(0)
    expect(beatDragSeconds(30, 300, 0)).toBe(0)
  })
})

describe('drag resolution', () => {
  const video = 60

  it('moves freely when nothing is in the way, rounded to tenths', () => {
    expect(resolveBeatStart(11.04, 3, [], video)).toBe(11)
    expect(resolveBeatStart(0.06, 1, [window(10, 2)], video)).toBe(0.1)
  })

  it('stays inside the video timeline', () => {
    expect(resolveBeatStart(999, 3, [], video)).toBe(57)
    expect(resolveBeatStart(-8, 3, [], video)).toBe(0)
  })

  it('clamps only at zero when the video length is unknown', () => {
    expect(resolveBeatStart(-4, 3, [], null)).toBe(0)
    expect(resolveBeatStart(5000, 3, [], null)).toBe(3597)
  })

  it('snaps against the neighbour edge the drag came from', () => {
    const other = window(10, 3)
    expect(resolveBeatStart(11, 3, [other], video, 5)).toBe(7)
    expect(resolveBeatStart(11, 3, [other], video, 20)).toBe(13)
  })

  it('picks the nearest edge without a remembered start', () => {
    expect(resolveBeatStart(11, 3, [window(10, 3)], video)).toBe(13)
    expect(resolveBeatStart(8.8, 3, [window(10, 3)], video)).toBe(7)
  })

  it('allows windows to touch but never overlap', () => {
    expect(resolveBeatStart(7, 3, [window(10, 3)], video)).toBe(7)
    expect(resolveBeatStart(8, 3, [window(10, 3)], video, 0)).toBe(7)
    const start = resolveBeatStart(9.5, 2, [window(10, 3)], video, 4)
    expect(start + 2).toBeLessThanOrEqual(10)
  })

  it('steps over a chain of neighbours when the nearest edge is still occupied', () => {
    expect(resolveBeatStart(1.5, 2, [window(1, 1), window(2, 1)], video, 5)).toBe(3)
  })
})
