import { beforeEach, describe, expect, it } from 'vitest'
import {
  attachMediaPlayer,
  handOffMediaPlayback,
  recallPlayback,
  rememberPlayback,
  syncMediaPlayers,
} from '@/features/canvas/media-playback'

function fakeVideo(values: { time?: number; paused?: boolean; ended?: boolean; duration?: number; readyState?: number } = {}) {
  const media = {
    currentTime: values.time ?? 0,
    paused: values.paused ?? true,
    ended: values.ended ?? false,
    duration: values.duration ?? 120,
    readyState: values.readyState ?? 2,
    playCalls: 0,
    pause() { this.paused = true },
    play() { this.playCalls += 1; this.paused = false; return Promise.resolve() },
  }
  return media as typeof media & HTMLMediaElement
}

const SRC = 'https://assets.test/clip.mp4'

describe('media playback handoff between the card and the enlarged preview', () => {
  beforeEach(() => {
    rememberPlayback(SRC, 0, false)
  })

  it('remembers one position per media url and ignores invalid times', () => {
    rememberPlayback(SRC, 12.5, true)
    expect(recallPlayback(SRC)).toEqual({ time: 12.5, playing: true })
    expect(recallPlayback('https://assets.test/other.mp4')).toBeUndefined()
    rememberPlayback(SRC, Number.NaN, false)
    expect(recallPlayback(SRC)).toEqual({ time: 0, playing: false })
  })

  it('pauses the card and reports its exact position so the preview can continue', () => {
    const card = fakeVideo({ time: 42, paused: false, readyState: 3 })
    const detach = attachMediaPlayer(SRC, card)
    const start = handOffMediaPlayback(SRC, fakeVideo())
    expect(card.paused).toBe(true)
    expect(start).toEqual({ time: 42, playing: true })
    detach()
  })

  it('stops tracking a detached player', () => {
    const card = fakeVideo({ time: 9, paused: false })
    const detach = attachMediaPlayer(SRC, card)
    detach()
    rememberPlayback(SRC, 0, false)
    expect(handOffMediaPlayback(SRC)).toEqual({ time: 0, playing: false })
    expect(card.paused).toBe(false)
  })

  it('moves remaining card players to where the preview stopped and resumes them when asked', () => {
    const card = fakeVideo({ time: 3, paused: true })
    const detach = attachMediaPlayer(SRC, card)
    rememberPlayback(SRC, 61, false)
    syncMediaPlayers(SRC, { resume: true })
    expect(card.currentTime).toBe(61)
    expect(card.playCalls).toBe(1)
    detach()
  })

  it('does not seek past the end of the remaining player', () => {
    const card = fakeVideo({ time: 3, duration: 60 })
    const detach = attachMediaPlayer(SRC, card)
    rememberPlayback(SRC, 60, false)
    syncMediaPlayers(SRC)
    expect(card.currentTime).toBe(3)
    detach()
  })
})
