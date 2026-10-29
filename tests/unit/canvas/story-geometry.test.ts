import { describe, expect, it } from 'vitest'
import type { CanvasFlowNode } from '@/features/canvas/editor-types'
import { handleBoxCenter, resolveStoryWireTarget, storyEdgeEnds, storyWireRole, type StoryGeometryNode } from '@/features/canvas/story/story-geometry'
import { storyWireLink, storyWireRefusal } from '@/features/canvas/story/useStoryCanvasActions'

const PORT = 16

/** An internal node whose ports sit where story-canvas.css puts them (rendered at scale 1). */
function card(id: string, type: string, x: number, y: number, width: number, height: number, data: Record<string, unknown> = {}): StoryGeometryNode {
  const outs = type === 'story_choice'
    ? (data.options as Array<{ id: string }>).map((option, index) => ({ id: option.id, y: 60 + index * 34 }))
    : type === 'story_exit' || type === 'story_ending' ? [] : [{ id: 'output', y: 22 }]
  const handles = [
    ...(type === 'story_entry' ? [] : [{ id: 'input', x: -PORT / 2, y: 22 - PORT / 2, width: PORT, height: PORT }]),
    ...outs.map((out) => ({ id: out.id, x: width - PORT / 2, y: out.y - PORT / 2, width: PORT, height: PORT })),
    ...(type === 'story_scene' ? [{ id: 'media', x: width / 2 - PORT / 2, y: -PORT / 2, width: PORT, height: PORT }] : []),
  ]
  const isStory = type.startsWith('story_')
  return { id, type, data, measured: { width, height }, internals: { positionAbsolute: { x, y }, handleBounds: { source: isStory ? handles : [] } } }
}

const options = [{ id: 'o1', label: 'A', effects: [] }, { id: 'o2', label: 'B', effects: [] }]
const sceneA = card('a', 'story_scene', 0, 0, 300, 330)
const sceneB = card('b', 'story_scene', 500, 0, 300, 330)
const choice = card('c', 'story_choice', 500, 500, 300, 196, { options })
const entry = card('e', 'story_entry', -400, 0, 240, 98)
const video = card('v', 'video', 0, -400, 300, 200)
const text = card('t', 'text', 900, 500, 300, 200)
const nodes = [sceneA, sceneB, choice, entry, video, text]
const flowNodes = nodes.map((node) => ({ id: node.id, type: node.type, position: node.internals.positionAbsolute, data: { title: node.id, ...(node.data as object) } })) as CanvasFlowNode[]
const target = (from: StoryGeometryNode, fromHandle: string, point: { x: number; y: number }, edges = [] as Array<{ source: string; sourceHandle?: string; data?: { role?: unknown } }>) =>
  resolveStoryWireTarget({ from, fromHandle, point, nodes, edges, scale: 1, zoom: 1 })

describe('story wire geometry', () => {
  it('reads handle offsets in zoomed pixels and sizes in layout pixels', () => {
    expect(handleBoxCenter({ x: 100, y: 50 }, { x: 24, y: 12, width: 16, height: 16 }, 1.2)).toEqual({ x: 128, y: 68 })
  })

  it('names what a wire means by the handle it leaves', () => {
    expect(storyWireRole(sceneA, 'output')).toBe('forward')
    expect(storyWireRole(sceneA, 'input')).toBe('backward')
    expect(storyWireRole(sceneA, 'media')).toBe('media-pick')
    expect(storyWireRole(entry, 'input')).toBeNull()
    expect(storyWireRole(card('x', 'story_exit', 0, 0, 240, 92), 'output')).toBeNull()
    expect(storyWireRole(video, 'output')).toBe('media')
    expect(storyWireRole(video, 'input')).toBeNull()
    expect(storyWireRole(text, 'output')).toBeNull()
  })

  it('snaps a forward wire to the nearest input port, or to the input of the card under the pointer', () => {
    const near = target(sceneA, 'output', { x: 512, y: 30 })
    expect(near?.point).toEqual({ x: 500, y: 22 })
    expect(near?.connection).toEqual({ source: 'a', sourceHandle: 'output', target: 'b', targetHandle: 'input' })
    expect(target(sceneA, 'output', { x: 700, y: 250 })?.connection.target).toBe('b')
    expect(target(sceneA, 'output', { x: -300, y: 50 })).toBeNull()
  })

  it('lands a backward wire on the first free option of a choice', () => {
    const used = [{ source: 'c', sourceHandle: 'o1', data: { role: 'STORY_FLOW' } }]
    expect(target(sceneB, 'input', { x: 650, y: 600 }, used)?.connection).toEqual({ source: 'c', sourceHandle: 'o2', target: 'b', targetHandle: 'input' })
  })

  it('routes pictures into the scene top port from either end', () => {
    expect(target(video, 'output', { x: 650, y: 200 })?.connection).toEqual({ source: 'v', sourceHandle: 'output', target: 'b', targetHandle: 'media' })
    expect(target(sceneA, 'media', { x: 150, y: -300 })?.connection).toEqual({ source: 'v', sourceHandle: 'output', target: 'a', targetHandle: 'media' })
  })

  it('draws flows port to port and pictures from the media card into the top port', () => {
    expect(storyEdgeEnds({ source: sceneA, target: sceneB, sourceHandle: 'output', flow: true, scale: 1 }))
      .toMatchObject({ source: { x: 300, y: 22 }, target: { x: 500, y: 22 } })
    expect(storyEdgeEnds({ source: video, target: sceneA, flow: false, scale: 1 }))
      .toMatchObject({ source: { x: 150, y: -200 }, target: { x: 150, y: 0 } })
  })
})

describe('story wire outcomes', () => {
  it('connects a node created from a released wire back to its source', () => {
    const fresh = { id: 'n', type: 'story_choice', data: { options } }
    expect(storyWireLink('forward', 'c', 'o2', { id: 'n', type: 'story_scene' })).toEqual({ source: 'c', sourceHandle: 'o2', target: 'n', targetHandle: 'input' })
    expect(storyWireLink('backward', 'b', 'input', fresh)).toEqual({ source: 'n', sourceHandle: 'o1', target: 'b', targetHandle: 'input' })
    expect(storyWireLink('media', 'v', 'output', { id: 'n', type: 'story_scene' })).toEqual({ source: 'v', sourceHandle: 'output', target: 'n', targetHandle: 'media' })
    expect(storyWireLink('media-pick', 'a', 'media', { id: 'n', type: 'video' })).toEqual({ source: 'n', sourceHandle: 'output', target: 'a', targetHandle: 'media' })
  })

  it('explains a refused drop as what to do instead', () => {
    expect(storyWireRefusal('media-pick', 'a', 'media', { id: 't', type: 'text' }, flowNodes)).toContain('视频或图片')
    expect(storyWireRefusal('forward', 'a', 'output', { id: 'v', type: 'video' }, flowNodes)).toContain('顶部的接口')
    expect(storyWireRefusal('forward', 'a', 'output', { id: 't', type: 'text' }, flowNodes)).toContain('只能连接剧情节点')
    expect(storyWireRefusal('forward', 'a', 'output', { id: 'e', type: 'story_entry' }, flowNodes)).toContain('入口不能被连入')
  })
})
