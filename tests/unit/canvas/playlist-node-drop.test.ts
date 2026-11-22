import { describe, expect, it } from 'vitest'
import { CANVAS_PLAYLIST_MAX_ITEMS } from '@/lib/canvas/playlist'
import {
  appendCanvasVideoSourceToPlaylist,
  canvasVideoDurationMs,
  canvasVideoSourceTitle,
  findCanvasPlaylistDropTargetId,
  isCanvasVideoSource,
} from '@/features/canvas/playlist-node-drop'
import type { CanvasFlowNode } from '@/features/canvas/editor-types'

function flowNode(input: {
  id: string
  type?: string
  x?: number
  y?: number
  width?: number
  height?: number
  data?: CanvasFlowNode['data']
}): CanvasFlowNode {
  return {
    id: input.id,
    type: input.type || 'video',
    position: { x: input.x || 0, y: input.y || 0 },
    width: input.width || 320,
    height: input.height || 220,
    data: input.data || { title: input.id, mediaType: 'video' },
  }
}

describe('canvas playlist node drop', () => {
  it('selects a Playlist only after the video meaningfully enters it', () => {
    const playlist = flowNode({ id: 'playlist', type: 'playlist', x: 300, width: 1_040, height: 640, data: { title: '终审' } })
    const barelyTouching = flowNode({ id: 'video', x: 20, y: 100, data: { title: '镜头', mediaType: 'video', videoUrl: 'video.mp4' } })
    const inside = { ...barelyTouching, position: { x: 160, y: 100 } }

    expect(findCanvasPlaylistDropTargetId([barelyTouching, playlist], barelyTouching)).toBeNull()
    expect(findCanvasPlaylistDropTargetId([inside, playlist], inside)).toBe('playlist')
  })

  it('chooses the Playlist with the largest overlap', () => {
    const video = flowNode({ id: 'video', x: 420, y: 120, data: { title: '镜头', mediaType: 'video', videoUrl: 'video.mp4' } })
    const first = flowNode({ id: 'first', type: 'playlist', x: 0, width: 600, height: 500, data: { title: 'A' } })
    const second = flowNode({ id: 'second', type: 'playlist', x: 500, width: 800, height: 500, data: { title: 'B' } })

    expect(findCanvasPlaylistDropTargetId([video, first, second], video)).toBe('second')
  })

  it('adds a ready generated video with its source identity and duration', () => {
    const source = flowNode({
      id: 'generated-video',
      data: {
        title: '镜头 03',
        mediaType: 'video',
        videoUrl: 'https://media.example/shot-03.mp4',
        posterUrl: 'https://media.example/shot-03.jpg',
        materialId: 'material-03',
        sourceMetadata: { durationMs: 6_400 },
      },
    })
    const result = appendCanvasVideoSourceToPlaylist([], source, () => 'clip-03')

    expect(isCanvasVideoSource(source)).toBe(true)
    expect(canvasVideoDurationMs(source)).toBe(6_400)
    expect(result).toEqual({
      outcome: 'added',
      items: [{
        id: 'clip-03',
        sourceNodeId: 'generated-video',
        materialId: 'material-03',
        title: '镜头 03',
        videoUrl: 'https://media.example/shot-03.mp4',
        posterUrl: 'https://media.example/shot-03.jpg',
        sourceInMs: 0,
        sourceOutMs: 6_400,
        durationMs: 6_400,
      }],
    })
  })

  it('labels comparison takes with their numbered suffix so equal-duration takes stay distinguishable', () => {
    const first = flowNode({
      id: 'take-1',
      data: { title: '镜头一', comparisonIndex: 1, mediaType: 'video', videoUrl: 'https://media.example/take-1.mp4', sourceMetadata: { durationMs: 5_000 } },
    })
    const second = flowNode({
      id: 'take-2',
      data: { title: '镜头一', comparisonIndex: 2, mediaType: 'video', videoUrl: 'https://media.example/take-2.mp4', sourceMetadata: { durationMs: 5_000 } },
    })
    expect(canvasVideoSourceTitle(first)).toBe('镜头一 · 对照 1')
    expect(canvasVideoSourceTitle(second)).toBe('镜头一 · 对照 2')
    const result = appendCanvasVideoSourceToPlaylist(
      appendCanvasVideoSourceToPlaylist([], first, () => 'clip-1').items,
      second,
      () => 'clip-2',
    )
    expect(result.items.map((item) => item.title)).toEqual(['镜头一 · 对照 1', '镜头一 · 对照 2'])
  })

  it('rejects unfinished, duplicate and over-capacity drops without changing clips', () => {
    const pending = flowNode({ id: 'pending', data: { title: '生成中', mediaType: 'video' } })
    expect(appendCanvasVideoSourceToPlaylist([], pending).outcome).toBe('not_ready')

    const ready = flowNode({ id: 'ready', data: { title: '完成', mediaType: 'video', videoUrl: 'ready.mp4' } })
    const existing = [{ id: 'clip', sourceNodeId: 'ready', title: '完成', videoUrl: 'ready.mp4', sourceInMs: 0 }]
    expect(appendCanvasVideoSourceToPlaylist(existing, ready).outcome).toBe('duplicate')

    const full = Array.from({ length: CANVAS_PLAYLIST_MAX_ITEMS }, (_, index) => ({
      id: `clip-${index}`,
      sourceNodeId: `source-${index}`,
      title: `Clip ${index}`,
      videoUrl: `${index}.mp4`,
      sourceInMs: 0,
    }))
    expect(appendCanvasVideoSourceToPlaylist(full, ready).outcome).toBe('full')
  })
})
