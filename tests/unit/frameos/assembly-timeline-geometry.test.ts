import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ComputedClip } from '@/features/video-editor/types/editor.types'
import {
  assemblyClipWidths,
  assemblyRulerFrames,
  assemblyTimelineWidth,
  clientXToCssOffset,
  sourceAudioTimelineStart,
  timelineFrameToOffset,
  timelineOffsetToFrame,
  timelineOffsetToLocation,
  visualClipStartOffset,
} from '@/features/video-editor/utils/assembly-timeline'

function clip(id: string, startFrame: number, durationInFrames: number): ComputedClip {
  return {
    id,
    src: `${id}.mp4`,
    startFrame,
    endFrame: startFrame + durationInFrames,
    durationInFrames,
    metadata: { panelId: id, storyboardId: 'storyboard-1' },
  }
}

describe('assembly timeline geometry', () => {
  it('maps screen pixels back to logical timeline pixels under 120% app zoom', () => {
    expect(clientXToCssOffset(244, 100, 720, 600)).toBe(120)
    expect(clientXToCssOffset(220, 100, 0, 0)).toBe(120)
  })

  it('maps the playhead through variable-width clips without drifting', () => {
    const positions = [clip('a', 0, 30), clip('b', 30, 30)]
    const widths = [100, 200]

    expect(timelineFrameToOffset(0, positions, widths)).toBe(7)
    expect(timelineFrameToOffset(30, positions, widths)).toBe(107)
    expect(timelineFrameToOffset(45, positions, widths)).toBe(210)
    expect(timelineFrameToOffset(60, positions, widths)).toBe(310)
    expect(timelineOffsetToFrame(7, positions, widths)).toBe(0)
    expect(timelineOffsetToFrame(109, positions, widths)).toBe(30)
    expect(timelineOffsetToFrame(210, positions, widths)).toBe(45)
    expect(timelineOffsetToFrame(310, positions, widths)).toBe(60)
  })

  it('keeps legacy audio attached while honoring an explicitly moved position', () => {
    expect(sourceAudioTimelineStart(90, { id: 'legacy', from: 12, to: 42, volume: 1 })).toBe(102)
    expect(sourceAudioTimelineStart(90, { id: 'moved', from: 12, to: 42, volume: 1, timelineStartFrame: 18 })).toBe(18)
  })

  it('anchors an overlapping transition frame to the selected clip boundary', () => {
    const positions = [clip('a', 0, 40), clip('b', 30, 30)]
    const widths = [160, 120]

    expect(timelineFrameToOffset(30, positions, widths)).toBe(127)
    expect(timelineFrameToOffset(30, positions, widths, 'b')).toBe(visualClipStartOffset(1, widths))
    expect(timelineOffsetToLocation(visualClipStartOffset(1, widths), positions, widths)).toEqual({ frame: 30, clipId: 'b' })
  })

  it('uses exact source trims without forcing a seek on every playback frame', () => {
    const source = readFileSync(path.join(process.cwd(), 'src/features/video-editor/remotion/VideoComposition.tsx'), 'utf8')

    expect(source).toContain('trimBefore={trimBefore}')
    expect(source).toContain('trimAfter={trimAfter}')
    expect(source).toContain('pauseWhenBuffering')
    expect(source).toContain('acceptableTimeShiftInSeconds={getPlaybackTimeShiftTolerance(playing, clipDuration, config.fps)}')
  })

  it('stretches short sequences to fill the visible track and keeps long ones scrollable', () => {
    const fitted = assemblyClipWidths({ durations: [76, 74], fps: 30, zoom: 1, fitTrackWidth: 1_200 })
    expect(assemblyTimelineWidth(fitted, 1_200)).toBeCloseTo(1_200, 0)
    expect(fitted[0]).toBeGreaterThan(500)
    expect(fitted[1]).toBeGreaterThan(500)

    const scrolled = assemblyClipWidths({ durations: [900, 900], fps: 30, zoom: 1, fitTrackWidth: 400 })
    expect(assemblyTimelineWidth(scrolled, 400)).toBeGreaterThan(400)
  })

  it('thins ruler labels when the track is narrow and keeps endpoints readable', () => {
    const compact = assemblyRulerFrames(150, 30, 240)
    const spacious = assemblyRulerFrames(150, 30, 1_400)

    expect(compact[0]).toBe(0)
    expect(compact.at(-1)).toBe(150)
    expect(compact.length).toBeLessThanOrEqual(5)
    expect(spacious[0]).toBe(0)
    expect(spacious.at(-1)).toBe(150)
    expect(spacious.length).toBeGreaterThan(compact.length)
  })

  it('keeps save visible in both the timeline and the review workflow', () => {
    const timeline = readFileSync(path.join(process.cwd(), 'src/components/frameos/views/FosAssemblyTimeline.tsx'), 'utf8')
    const editor = readFileSync(path.join(process.cwd(), 'src/components/frameos/views/FosAssemblyEditor.tsx'), 'utf8')

    expect(timeline).toContain("isDirty ? '保存剪辑' : '剪辑已保存'")
    expect(editor).toContain("isDirty ? '第一步 · 保存当前剪辑'")
    expect(editor).toContain("saving ? '保存中…' : '保存剪辑'")
    expect(editor).toContain("status === 'in_progress' || status === 'rejected'")
    expect(editor).toContain('当前执行人：${submitterLabel')
  })
})
