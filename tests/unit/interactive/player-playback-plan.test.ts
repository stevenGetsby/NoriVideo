import { describe, expect, it } from 'vitest'
import { pictureState } from '@/features/interactive/player/playback-plan'
import { STORY_SLOW_RATE } from '@/lib/interactive/interaction'

describe('the picture outside an interaction', () => {
  it('runs at the viewer speed, including on scenes without beats', () => {
    expect(pictureState(1.25, null, false)).toEqual({ rate: 1.25, playing: true })
    expect(pictureState(1.5, null, false)).toEqual({ rate: 1.5, playing: true })
    expect(pictureState(1, null, false)).toEqual({ rate: 1, playing: true })
  })

  it('stops while a sheet or the continue prompt covers the stage, keeping the element ready', () => {
    expect(pictureState(1.25, null, true)).toEqual({ rate: 1.25, playing: false })
  })
})

describe('the picture inside an interaction', () => {
  it('uses the interaction pace, never the viewer speed', () => {
    expect(pictureState(1.5, 'play', false)).toEqual({ rate: 1, playing: true })
    expect(pictureState(1.5, 'slow', false)).toEqual({ rate: STORY_SLOW_RATE, playing: true })
    expect(pictureState(1.25, 'slow', false)).toEqual({ rate: STORY_SLOW_RATE, playing: true })
  })

  it('freezes regardless of speed and sheets, because playbackRate 0 is not a pause', () => {
    expect(pictureState(1.5, 'freeze', false)).toEqual({ rate: 1, playing: false })
    expect(pictureState(1, 'freeze', true)).toEqual({ rate: 1, playing: false })
  })

  it('runs an interaction at real pace when a speed other than 1x was chosen', () => {
    expect(pictureState(1, 'play', false).rate).toBe(1)
    expect(pictureState(1, 'slow', false).rate).toBeGreaterThan(0)
  })
})
