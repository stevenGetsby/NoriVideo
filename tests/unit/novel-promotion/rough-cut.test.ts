import { describe, expect, it } from 'vitest'
import {
  createRoughCutProject,
  normalizeRoughCutProject,
  roughCutClipRangeMs,
  type RoughCutSourcePanel,
} from '@/lib/novel-promotion/rough-cut'

const sources: RoughCutSourcePanel[] = [
  {
    panelId: 'panel-1', storyboardId: 'storyboard-1', sceneLabel: 'S01', segmentLabel: 'Segment 01',
    description: '第一镜', imageUrl: 'one.jpg', videoUrl: 'one.mp4', durationMs: 5_000,
  },
  {
    panelId: 'panel-2', storyboardId: 'storyboard-1', sceneLabel: 'S01', segmentLabel: 'Segment 02',
    description: '第二镜', imageUrl: 'two.jpg', videoUrl: 'two.mp4', durationMs: 6_000,
  },
]

describe('rough-cut project contract', () => {
  it('creates a frame-accurate default project in storyboard order', () => {
    const project = createRoughCutProject('episode-1', sources)

    expect(project.timeline.map((clip) => clip.metadata.panelId)).toEqual(['panel-1', 'panel-2'])
    expect(project.timeline[0]).toMatchObject({
      src: 'one.mp4',
      durationInFrames: 150,
      trim: { from: 0, to: 150 },
      metadata: { sourceDurationInFrames: 150 },
    })
  })

  it('preserves saved order and trims while canonicalizing media URLs', () => {
    const project = normalizeRoughCutProject({
      id: 'saved',
      episodeId: 'episode-1',
      config: { fps: 30, width: 1920, height: 1080 },
      timeline: [
        { id: 'clip-2', src: 'stale.mp4', durationInFrames: 90, trim: { from: 30, to: 120 }, metadata: { panelId: 'panel-2' } },
        { id: 'clip-1', src: 'stale.mp4', durationInFrames: 60, trim: { from: 15, to: 75 }, metadata: { panelId: 'panel-1' } },
      ],
    }, 'episode-1', sources)

    expect(project?.timeline.map((clip) => clip.metadata.panelId)).toEqual(['panel-2', 'panel-1'])
    expect(project?.timeline[0]).toMatchObject({ src: 'two.mp4', durationInFrames: 90, trim: { from: 30, to: 120 } })
    expect(roughCutClipRangeMs(project!.timeline[0], 30)).toEqual({ trimStartMs: 1_000, trimEndMs: 4_000, durationMs: 3_000 })
  })

  it('removes legacy transition overlap so adjacent clips have one exclusive cut frame', () => {
    const project = normalizeRoughCutProject({
      episodeId: 'episode-1',
      timeline: [
        {
          id: 'clip-1',
          metadata: { panelId: 'panel-1' },
          trim: { from: 0, to: 150 },
          transition: { type: 'dissolve', durationInFrames: 15 },
        },
        { id: 'clip-2', metadata: { panelId: 'panel-2' }, trim: { from: 0, to: 180 } },
      ],
    }, 'episode-1', sources)

    expect(project?.timeline[0].transition).toBeUndefined()
    expect(project?.timeline[1].transition).toBeUndefined()
  })

  it('drops unknown references and canonicalizes split clips that share one panel source', () => {
    const project = normalizeRoughCutProject({
      episodeId: 'episode-1',
      timeline: [
        { src: 'evil.mp4', metadata: { panelId: 'missing' } },
        { src: 'evil.mp4', metadata: { panelId: 'panel-1' } },
        { src: 'duplicate.mp4', metadata: { panelId: 'panel-1' } },
      ],
    }, 'episode-1', sources)

    expect(project?.timeline).toHaveLength(2)
    expect(project?.timeline.map((clip) => clip.src)).toEqual(['one.mp4', 'one.mp4'])
  })

  it('preserves independently cut source-audio segments', () => {
    const project = normalizeRoughCutProject({
      episodeId: 'episode-1',
      timeline: [{
        id: 'clip-1',
        metadata: { panelId: 'panel-1' },
        trim: { from: 0, to: 150 },
        sourceAudio: {
          detached: true,
          volume: 1,
          segments: [
            { id: 'audio-left', from: 0, to: 45, volume: 1 },
            { id: 'audio-right', from: 90, to: 150, volume: 0.8, timelineStartFrame: 24 },
          ],
        },
      }],
    }, 'episode-1', sources)

    expect(project?.timeline[0].sourceAudio?.segments).toEqual([
      { id: 'audio-left', from: 0, to: 45, volume: 1 },
      { id: 'audio-right', from: 90, to: 150, volume: 0.8, timelineStartFrame: 24 },
    ])
  })
})
