import { describe, expect, it } from 'vitest'
import {
  CANVAS_PLAYLIST_FPS,
  canvasPlaylistClipDurationMs,
  canvasPlaylistEditorProject,
  canvasPlaylistFingerprint,
  canvasPlaylistFrameToMs,
  canvasPlaylistItemFrameRange,
  canvasPlaylistMsToFrame,
  canvasPlaylistScopeId,
  isCanvasPlaylistScopeId,
  normalizeCanvasPlaylistItems,
  resolveCanvasPlaylistTimeline,
} from '@/lib/canvas/playlist'

describe('canvas playlist', () => {
  it('normalizes stable items and computes non-destructive trim duration', () => {
    const items = normalizeCanvasPlaylistItems([
      { id: 'clip-1', title: 'A', sourceInMs: 1_000, sourceOutMs: 4_500, durationMs: 8_000 },
      { id: 'clip-1', title: 'B', sourceInMs: -4, sourceOutMs: 2_000, durationMs: 3_000 },
      null,
    ])
    expect(items).toHaveLength(2)
    expect(items[0].id).toBe('clip-1')
    expect(items[1].id).not.toBe('clip-1')
    expect(items[1].sourceInMs).toBe(0)
    expect(canvasPlaylistClipDurationMs(items[0])).toBe(3_500)
  })

  it('uses the same 30fps frame contract as the project rough-cut editor', () => {
    const item = normalizeCanvasPlaylistItems([
      { id: 'clip-1', title: 'A', videoUrl: 'a.mp4', posterUrl: 'a.jpg', sourceInMs: 500, sourceOutMs: 2_500, durationMs: 4_000 },
    ])[0]
    const range = canvasPlaylistItemFrameRange(item)
    const project = canvasPlaylistEditorProject('playlist-1', [item])

    expect(CANVAS_PLAYLIST_FPS).toBe(30)
    expect(canvasPlaylistMsToFrame(500)).toBe(15)
    expect(canvasPlaylistFrameToMs(15)).toBe(500)
    expect(range).toEqual({ from: 15, to: 75, sourceDurationInFrames: 120 })
    expect(project.config.fps).toBe(30)
    expect(project.timeline[0]).toMatchObject({
      durationInFrames: 60,
      trim: { from: 15, to: 75 },
      metadata: { sourceDurationInFrames: 120, imageUrl: 'a.jpg' },
    })
  })

  it('keeps a one-frame minimum range instead of falling back to 0.1 seconds', () => {
    const item = normalizeCanvasPlaylistItems([
      { id: 'clip-1', title: 'A', sourceInMs: 0, sourceOutMs: 33, durationMs: 1_000 },
    ])[0]

    expect(canvasPlaylistItemFrameRange(item)).toEqual({ from: 0, to: 1, sourceDurationInFrames: 30 })
    expect(canvasPlaylistClipDurationMs(item)).toBe(33)
  })

  it('builds an immutable sequential review timeline from current source nodes', () => {
    const result = resolveCanvasPlaylistTimeline({
      projectName: '海外短剧',
      canvasId: 'canvas-1',
      nodeId: 'playlist-1',
      title: '第一集终剪',
      requireReady: true,
      capturedAt: '2026-07-30T00:00:00.000Z',
      items: [
        { id: 'clip-a', sourceNodeId: 'video-a', title: '旧标题', sourceInMs: 500, sourceOutMs: 2_500, durationMs: 4_000 },
        { id: 'clip-b', sourceNodeId: 'video-b', title: 'B', sourceInMs: 0, sourceOutMs: 3_000, durationMs: 3_000 },
      ],
      sourceNodes: [
        { id: 'video-a', type: 'video', data: { title: '镜头 A', videoUrl: 'https://media.example/a.mp4', prompt: 'A prompt' } },
        { id: 'video-b', type: 'production_video', data: { title: '镜头 B', videoUrl: 'https://media.example/b.mp4' } },
      ],
    })
    expect(result.snapshot.episodeName).toBe('第一集终剪')
    expect(result.snapshot.durationMs).toBe(5_000)
    expect(result.snapshot.segments.map((segment) => [segment.startMs, segment.endMs])).toEqual([[0, 2_000], [2_000, 5_000]])
    expect(result.snapshot.segments[0]).toMatchObject({
      panelId: 'clip-a',
      label: 'Clip 01 · 镜头 A',
      trimStartMs: 500,
      trimEndMs: 2_500,
      videoUrl: 'https://media.example/a.mp4',
    })
    expect(result.target).toMatchObject({ kind: 'canvas_playlist', canvasId: 'canvas-1', nodeId: 'playlist-1' })
  })

  it('rejects empty or unresolved submissions and exposes a stable task scope', () => {
    expect(() => resolveCanvasPlaylistTimeline({
      projectName: 'P', canvasId: 'c', nodeId: 'n', title: 'T', items: [], sourceNodes: [], requireReady: true,
    })).toThrow('播放列表为空')
    expect(() => resolveCanvasPlaylistTimeline({
      projectName: 'P', canvasId: 'c', nodeId: 'n', title: 'T',
      items: [{ id: 'clip', sourceNodeId: 'missing', title: 'T', sourceInMs: 0, sourceOutMs: 1_000, durationMs: 1_000 }],
      sourceNodes: [],
      requireReady: true,
    })).toThrow('已失效的视频')
    const scope = canvasPlaylistScopeId('canvas-1', 'node-1')
    expect(scope).toBe('canvas-playlist:canvas-1:node-1')
    expect(isCanvasPlaylistScopeId(scope)).toBe(true)
  })

  it('invalidates an existing render identity when order or trim changes', () => {
    const clips = [
      { id: 'a', title: 'A', videoUrl: 'a.mp4', sourceInMs: 0, sourceOutMs: 1_000, durationMs: 2_000 },
      { id: 'b', title: 'B', videoUrl: 'b.mp4', sourceInMs: 0, sourceOutMs: 2_000, durationMs: 3_000 },
    ]
    const fingerprint = canvasPlaylistFingerprint(clips)

    expect(canvasPlaylistFingerprint(clips)).toBe(fingerprint)
    expect(canvasPlaylistFingerprint([...clips].reverse())).not.toBe(fingerprint)
    expect(canvasPlaylistFingerprint([{ ...clips[0], sourceOutMs: 900 }, clips[1]])).not.toBe(fingerprint)
  })
})
