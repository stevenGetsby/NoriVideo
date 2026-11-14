import { describe, expect, it } from 'vitest'
import type { CanvasFlowEdge, CanvasFlowNode } from '@/features/canvas/editor-types'
import { mountedBeats, nextBeatStart, sceneVideoDurationSec } from '@/features/canvas/story/story-beats'

function node(id: string, type: string, data: Record<string, unknown> = {}): CanvasFlowNode {
  return { id, type, position: { x: 0, y: 0 }, data: { title: id, ...data } } as CanvasFlowNode
}
const mount = (scene: string, beat: string): CanvasFlowEdge =>
  ({ id: `${scene}>${beat}`, source: scene, target: beat, sourceHandle: 'interact', targetHandle: 'mount', data: { role: 'STORY_MOUNT' } }) as CanvasFlowEdge
const flow = (source: string, target: string): CanvasFlowEdge =>
  ({ id: `${source}:${target}`, source, target, sourceHandle: 'output', targetHandle: 'input', data: { role: 'STORY_FLOW' } }) as CanvasFlowEdge
const picture = (source: string, target: string): CanvasFlowEdge =>
  ({ id: `${source}~${target}`, source, target, sourceHandle: 'output', targetHandle: 'media', data: { role: 'REF' } }) as CanvasFlowEdge

describe('beats mounted on a scene', () => {
  const nodes = [
    node('scene', 'story_scene', { videoUrl: '/v.mp4', videoDurationSec: 60 }),
    node('other', 'story_scene'),
    node('late', 'story_interaction', { interaction: 'swipe', startSec: 40, durationSec: 1 }),
    node('early', 'story_interaction', { interaction: 'tap', startSec: 5.04, durationSec: 3, title: '连点' }),
    node('tie-b', 'story_interaction', { interaction: 'hold', startSec: 20 }),
    node('tie-a', 'story_interaction', { interaction: 'timing', startSec: 20 }),
    node('alone', 'story_interaction', { interaction: 'tap' }),
    node('choice', 'story_choice'),
  ]

  it('lists them in play order and breaks ties by id', () => {
    const edges = [mount('scene', 'late'), mount('scene', 'tie-b'), mount('scene', 'early'), mount('scene', 'tie-a')]
    expect(mountedBeats('scene', nodes, edges).map((beat) => beat.nodeId)).toEqual(['early', 'tie-a', 'tie-b', 'late'])
  })

  it('reads the title, kind, start and length from the node data like the player does', () => {
    expect(mountedBeats('scene', nodes, [mount('scene', 'early')])).toEqual([{ nodeId: 'early', title: '连点', kind: 'tap', startSec: 5, durationSec: 3 }])
    expect(mountedBeats('scene', nodes, [mount('scene', 'late')])[0]).toMatchObject({ title: 'late', kind: 'swipe', startSec: 40, durationSec: 1 })
  })

  it('only counts mounts of this scene that end on an interaction', () => {
    const edges = [mount('other', 'late'), mount('scene', 'choice'), mount('scene', 'missing'), flow('scene', 'alone'), picture('scene', 'early')]
    expect(mountedBeats('scene', nodes, edges)).toEqual([])
    expect(mountedBeats('other', nodes, edges).map((beat) => beat.nodeId)).toEqual(['late'])
  })
})

describe('scene video length', () => {
  it('uses the length recorded on the scene itself', () => {
    expect(sceneVideoDurationSec('scene', [node('scene', 'story_scene', { videoUrl: '/v.mp4', videoDurationSec: 61.5 })], [])).toBe(61.5)
  })

  it('falls back to the video wired into the scene picture port, in seconds or milliseconds', () => {
    const scene = node('scene', 'story_scene')
    const fromMs = node('v1', 'video', { videoUrl: '/a.mp4', sourceMetadata: { durationMs: 12500 } })
    const fromGeneration = node('v2', 'video', { videoUrl: '/b.mp4', generation: { duration: 8 } })
    expect(sceneVideoDurationSec('scene', [scene, fromMs], [picture('v1', 'scene')])).toBe(12.5)
    expect(sceneVideoDurationSec('scene', [scene, fromGeneration], [picture('v2', 'scene')])).toBe(8)
  })

  it('is unknown without a video, for a picture, for a video with no recorded length, and for a missing scene', () => {
    const scene = node('scene', 'story_scene')
    expect(sceneVideoDurationSec('scene', [scene], [])).toBeNull()
    expect(sceneVideoDurationSec('scene', [node('scene', 'story_scene', { imageUrl: '/p.png' })], [])).toBeNull()
    expect(sceneVideoDurationSec('scene', [scene, node('v', 'video', { videoUrl: '/c.mp4' })], [picture('v', 'scene')])).toBeNull()
    expect(sceneVideoDurationSec('gone', [scene], [])).toBeNull()
  })
})

describe('where a new beat starts', () => {
  const scene = node('scene', 'story_scene', { videoUrl: '/v.mp4', videoDurationSec: 60 })
  const placed = (id: string, startSec: number, durationSec: number) => node(id, 'story_interaction', { interaction: 'tap', startSec, durationSec })

  it('starts at the very beginning of an empty scene', () => {
    expect(nextBeatStart('scene', 'tap', [scene], [])).toBe(0)
  })

  it('steps past the beats already mounted and uses the default length of the new kind', () => {
    const nodes = [scene, placed('a', 0, 3), placed('b', 3, 4)]
    const edges = [mount('scene', 'a'), mount('scene', 'b')]
    expect(nextBeatStart('scene', 'swipe', nodes, edges)).toBe(7)
    expect(nextBeatStart('scene', 'hold', nodes, edges)).toBe(7)
  })

  it('finds a gap between beats before appending after the last one', () => {
    const nodes = [scene, placed('a', 0, 3), placed('b', 5, 4)]
    const edges = [mount('scene', 'a'), mount('scene', 'b')]
    expect(nextBeatStart('scene', 'swipe', nodes, edges)).toBe(3)
    expect(nextBeatStart('scene', 'tap', nodes, edges)).toBe(9)
    expect(nextBeatStart('scene', 'hold', nodes, edges)).toBe(9)
  })

  it('keeps the new beat inside the video, and ignores unmounted interactions', () => {
    const nodes = [scene, placed('a', 0, 59), placed('free', 0, 5)]
    expect(nextBeatStart('scene', 'tap', nodes, [mount('scene', 'a')])).toBe(57)
    expect(nextBeatStart('scene', 'tap', nodes, [])).toBe(0)
  })
})
