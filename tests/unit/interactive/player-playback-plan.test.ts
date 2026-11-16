import { describe, expect, it } from 'vitest'
import { pictureState, seekToLastFrame, standaloneBackdrop } from '@/features/interactive/player/playback-plan'
import { defaultInteractionData, readInteractionData, STORY_SLOW_RATE } from '@/lib/interactive/interaction'
import type { StoryInteractionNode, StoryMedia } from '@/lib/interactive/types'

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

describe('standalone interaction backdrop', () => {
  const video: StoryMedia = { kind: 'video', url: '/v.mp4', posterUrl: '/v.png' }
  const image: StoryMedia = { kind: 'image', url: '/i.png', posterUrl: '/i.png' }
  const node = (picture: StoryMedia | null): StoryInteractionNode => ({
    id: 'i',
    kind: 'interaction',
    mountedOn: null,
    ...readInteractionData(defaultInteractionData('tap', () => 'x')),
    picture,
  })

  it('plays its own picture when one is wired, regardless of the previous segment', () => {
    expect(standaloneBackdrop(node(video), image)).toEqual({ media: video, freeze: false })
    expect(standaloneBackdrop(node(video), null)).toEqual({ media: video, freeze: false })
  })

  it('freezes on the previous segment last frame when it has no picture of its own', () => {
    expect(standaloneBackdrop(node(null), video)).toEqual({ media: video, freeze: true })
    expect(standaloneBackdrop(node(null), image)).toEqual({ media: image, freeze: true })
  })

  it('falls back to an empty placeholder when neither exists', () => {
    expect(standaloneBackdrop(node(null), null)).toEqual({ media: null, freeze: true })
  })
})

describe('seekToLastFrame', () => {
  const makeFake = (duration: number) => {
    const fake = { duration, currentTime: 0, paused: false, pause: () => { fake.paused = true } }
    return fake
  }

  it('pauses just before the end so the last frame stays on screen', () => {
    const fake = makeFake(10)
    seekToLastFrame(fake as unknown as HTMLVideoElement)
    expect(fake.currentTime).toBeCloseTo(9.96)
    expect(fake.paused).toBe(true)
  })

  it('is safe before metadata arrives and on a null element', () => {
    const fake = makeFake(NaN)
    seekToLastFrame(fake as unknown as HTMLVideoElement)
    expect(fake.currentTime).toBe(0)
    expect(fake.paused).toBe(true)
    expect(() => seekToLastFrame(null)).not.toThrow()
  })
})
