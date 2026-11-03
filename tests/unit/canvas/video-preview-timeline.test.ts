import { describe, expect, it } from 'vitest'
import {
  adjacentPreviewKeyframe, detectPreviewShotBoundaries, mergePreviewKeyframes, normalizePreviewKeyframes, previewAudioIsSilent, previewAudioPeaks,
  previewFilmstripTiles, previewFrameDifference, previewFrameIndex, previewMaxZoom, previewRulerTicks, previewSeekTime, previewSliderFromZoom,
  previewTimecode, previewZoomFromSlider, snapPreviewFps, snapPreviewTime,
} from '@/features/canvas/video-preview-timeline'

function frame(r: number, g: number, b: number, pixels = 16) {
  return Uint8ClampedArray.from({ length: pixels * 4 }, (_, index) => [r, g, b, 255][index % 4])
}

describe('video preview timeline', () => {
  it('formats HH:MM:SS:FF timecode for the detected frame rate and clamps invalid times', () => {
    expect(previewTimecode(12.2)).toBe('00:00:12:06')
    expect(previewTimecode(65.999, 30)).toBe('00:01:05:29')
    expect(previewTimecode(3723.5, 25)).toBe('01:02:03:12')
    expect(previewTimecode(1.99, 23.976)).toBe('00:00:01:23')
    expect(previewTimecode(Number.NaN)).toBe('00:00:00:00')
    expect(previewTimecode(-3)).toBe('00:00:00:00')
  })

  it('seeks just inside the target frame so timebase rounding cannot show the previous one', () => {
    expect(previewFrameIndex(previewSeekTime(13 / 25, 25), 25)).toBe(13)
    expect(previewFrameIndex(previewSeekTime(16 / 30, 30), 30)).toBe(16)
    expect(previewSeekTime(0.52, 25)).toBeGreaterThan(0.52)
  })

  it('navigates to actual adjacent marks and stops at the first and last frame', () => {
    const marks = [0, 2.5, 8]
    expect(adjacentPreviewKeyframe(5, marks, 10, -1)).toBe(2.5)
    expect(adjacentPreviewKeyframe(5, marks, 10, 1)).toBe(8)
    expect(adjacentPreviewKeyframe(0.01, marks, 10, -1)).toBe(0)
    expect(adjacentPreviewKeyframe(9, marks, 10, 1)).toBeCloseTo(10 - 1 / 30, 3)
    expect(adjacentPreviewKeyframe(2.5, marks, 10, 1)).toBe(8)
    expect(adjacentPreviewKeyframe(2.501, marks, 10, -1)).toBe(0)
  })

  it('switches ruler labels from seconds to frames as the track zooms in', () => {
    const fit = previewRulerTicks(10, 90, 30)
    expect(fit.filter((tick) => tick.major).map((tick) => tick.label)).toEqual(['00:00', '00:01', '00:02', '00:03', '00:04', '00:05', '00:06', '00:07', '00:08', '00:09', '00:10'])
    expect(fit.filter((tick) => !tick.major).length).toBeGreaterThan(0)
    const zoomed = previewRulerTicks(2, 600, 30).filter((tick) => tick.major).map((tick) => tick.label)
    expect(zoomed.slice(0, 4)).toEqual(['00:00', '5f', '10f', '15f'])
    expect(previewRulerTicks(120, 9, 30).find((tick) => tick.major && tick.time > 0)?.label).toBe('00:10')
    const pal = previewRulerTicks(2, 400, 25).filter((tick) => tick.major).map((tick) => tick.label)
    expect(pal).toContain('00:01')
    expect(pal.every((label) => label === '00:00' || label === '00:01' || label === '00:02' || /^(5|10|15|20)f$/.test(label!))).toBe(true)
    expect(previewRulerTicks(0, 100)).toEqual([])
  })

  it('lays out aspect-correct filmstrip tiles that exactly cover the track', () => {
    const tiles = previewFilmstripTiles(10, 1000, 96)
    expect(tiles).toHaveLength(11)
    expect(tiles[10].left + tiles[10].width).toBeCloseTo(1000)
    expect(tiles[0].time).toBeCloseTo(0.48)
    expect(tiles.every((tile) => tile.time <= 10)).toBe(true)
    expect(previewFilmstripTiles(10, 0, 96)).toEqual([])
    expect(previewFilmstripTiles(10, 1_000_000, 10).length).toBeLessThanOrEqual(2000)
  })

  it('snaps only inside the tolerance and maps zoom logarithmically', () => {
    expect(snapPreviewTime(2.04, [0, 2, 5], 0.05)).toBe(2)
    expect(snapPreviewTime(2.2, [0, 2, 5], 0.05)).toBe(2.2)
    expect(previewMaxZoom(10, 900, 30)).toBe(6)
    expect(previewMaxZoom(2, 900, 25)).toBe(4)
    expect(previewZoomFromSlider(0, 6)).toBe(1)
    expect(previewZoomFromSlider(100, 6)).toBeCloseTo(6)
    expect(previewSliderFromZoom(previewZoomFromSlider(40, 6), 6)).toBeCloseTo(40)
  })

  it('builds bounded peaks and recognises silent audio', () => {
    const channel = new Float32Array(4000)
    channel[56] = 0.3
    channel[3080] = 0.8
    const audio = { getChannelData: () => channel } as unknown as AudioBuffer
    const peaks = previewAudioPeaks(audio, 4)
    expect(peaks).toHaveLength(4)
    expect(peaks[0]).toBeGreaterThan(peaks[1])
    expect(peaks[3]).toBeGreaterThan(peaks[2])
    expect(peaks.every((value) => value >= 0.08 && value <= 1)).toBe(true)
    expect(previewAudioPeaks(audio, 0)).toEqual([])
    expect(previewAudioIsSilent(previewAudioPeaks({ getChannelData: () => new Float32Array(400) } as unknown as AudioBuffer, 8))).toBe(true)
    expect(previewAudioIsSilent(peaks)).toBe(false)
  })

  it('snaps measured frame intervals to broadcast frame rates and ignores dropped frames', () => {
    expect(snapPreviewFps([0.04, 0.04, 0.08, 0.04, 0.04, 0.12])).toBe(25)
    expect(snapPreviewFps(Array(8).fill(1 / 23.976))).toBe(23.976)
    expect(snapPreviewFps([1 / 30, 1 / 30, 2 / 30, 1 / 30, 1 / 30])).toBe(30)
    expect(snapPreviewFps([0.04, 0.04])).toBeNull()
  })

  it('scores hard cuts above gradual motion and keeps cuts apart', () => {
    expect(previewFrameDifference(frame(20, 20, 20), frame(20, 20, 20))).toBe(0)
    expect(previewFrameDifference(frame(0, 0, 0), frame(255, 255, 255))).toBeCloseTo(1)
    expect(previewFrameDifference(frame(100, 100, 100), frame(108, 108, 108))).toBeLessThan(0.1)
    const samples = Array.from({ length: 40 }, (_, index) => ({ time: index * 0.125, difference: 0.02 + (index % 3) * 0.005 }))
    samples[10].difference = 0.6
    samples[11].difference = 0.3
    samples[25].difference = 0.55
    expect(detectPreviewShotBoundaries(samples)).toEqual([1.25, 3.125])
    expect(detectPreviewShotBoundaries(samples.map((sample) => ({ ...sample, difference: 0.03 })))).toEqual([])
  })

  it('normalises stored marks and merges detected shots without duplicating frames', () => {
    expect(normalizePreviewKeyframes([{ id: 'b', time: 2, kind: 'shot' }, { time: 1 }, { time: -1 }, { id: 'c', time: 2 }, null, 'x'])).toEqual([
      { id: 'kf-1000', time: 1, kind: 'manual' },
      { id: 'b', time: 2, kind: 'shot' },
    ])
    expect(normalizePreviewKeyframes('nope')).toEqual([])
    let next = 0
    const merged = mergePreviewKeyframes([{ id: 'a', time: 1, kind: 'manual' }], [1.01, 2.5, 2.51], 'shot', 25, () => `s${next++}`)
    expect(merged.added).toBe(1)
    expect(merged.keyframes).toEqual([{ id: 'a', time: 1, kind: 'manual' }, { id: 's0', time: 2.48, kind: 'shot' }])
  })
})
