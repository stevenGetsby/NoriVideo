import { describe, expect, it } from 'vitest'
import {
  decidePendingSeekFrame,
  getPlaybackTimeShiftTolerance,
  shouldPublishPlayerFrame,
  shouldSynchronizePlayerFrame,
} from '@/features/video-editor/utils/playback-sync'

describe('video editor player synchronization', () => {
  it('does not seek backwards to delayed React frames while playback is running', () => {
    expect(shouldSynchronizePlayerFrame(42, 48, true)).toBe(false)
    expect(shouldSynchronizePlayerFrame(110, 145, true)).toBe(false)
  })

  it('applies deliberate paused timeline seeks but ignores normal one-frame jitter', () => {
    expect(shouldSynchronizePlayerFrame(42, 48, false)).toBe(true)
    expect(shouldSynchronizePlayerFrame(47, 48, false)).toBe(false)
    expect(shouldSynchronizePlayerFrame(48, 48, false)).toBe(false)
  })

  it('rejects invalid frame values', () => {
    expect(shouldSynchronizePlayerFrame(Number.NaN, 0, false)).toBe(false)
    expect(shouldSynchronizePlayerFrame(0, Number.POSITIVE_INFINITY, false)).toBe(false)
  })

  it('relaxes media drift correction only during active playback', () => {
    expect(getPlaybackTimeShiftTolerance(true, 150, 30)).toBe(5)
    expect(getPlaybackTimeShiftTolerance(false, 150, 30)).toBeUndefined()
    expect(getPlaybackTimeShiftTolerance(true, 0, 30)).toBeUndefined()
    expect(getPlaybackTimeShiftTolerance(true, 150, 0)).toBeUndefined()
  })

  it('publishes each player frame at most once', () => {
    expect(shouldPublishPlayerFrame(42, null)).toBe(true)
    expect(shouldPublishPlayerFrame(42, 42)).toBe(false)
    expect(shouldPublishPlayerFrame(42.2, 42)).toBe(false)
    expect(shouldPublishPlayerFrame(43, 42)).toBe(true)
    expect(shouldPublishPlayerFrame(Number.NaN, 42)).toBe(false)
  })

  it('ignores queued old frames until a user-requested seek settles', () => {
    expect(decidePendingSeekFrame(24, 180)).toBe('ignore')
    expect(decidePendingSeekFrame(179, 180)).toBe('settled')
    expect(decidePendingSeekFrame(180, 180)).toBe('settled')
    expect(decidePendingSeekFrame(181, 180)).toBe('settled')
    expect(decidePendingSeekFrame(182, 180)).toBe('ignore')
    expect(decidePendingSeekFrame(182, null)).toBe('publish')
    expect(decidePendingSeekFrame(Number.NaN, 180)).toBe('ignore')
  })

  it('lets the newest seek win when the user clicks several positions quickly', () => {
    // The first requested position can arrive after a second click. It is now
    // stale and must not become the React playhead again.
    expect(decidePendingSeekFrame(24, 180)).toBe('ignore')
    expect(decidePendingSeekFrame(180, 420)).toBe('ignore')
    expect(decidePendingSeekFrame(419, 420)).toBe('settled')
    expect(decidePendingSeekFrame(420, null)).toBe('publish')
  })
})
