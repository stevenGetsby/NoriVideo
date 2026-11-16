import { describe, expect, it } from 'vitest'
import { compileStoryNode, resolveNodeMedia, resolveSceneMedia, type CanvasEdgeLike, type CanvasNodeLike } from '@/lib/interactive/compile'
import { STORY_FLOW_ROLE, STORY_MOUNT_ROLE, type StoryChoiceNode, type StoryInteractionNode, type StorySceneNode } from '@/lib/interactive/types'

const scene: CanvasNodeLike = { id: 's', type: 'story_scene', data: { title: '城头', videoUrl: '/s.mp4', posterUrl: '/s.png', videoDurationSec: 6 } }
const video: CanvasNodeLike = { id: 'v', type: 'video', data: { title: '画面', videoUrl: '/v.mp4', posterUrl: '/v.png', sourceMetadata: { durationMs: 4500 } } }
const image: CanvasNodeLike = { id: 'p', type: 'image', data: { title: '底图', imageUrl: '/p.png' } }
const tap: CanvasNodeLike = { id: 'i', type: 'story_interaction', data: { title: '点击', interaction: 'tap' } }
const pick: CanvasNodeLike = { id: 'c', type: 'story_choice', data: { title: '抉择', options: [{ id: 'o1', label: 'A' }] } }
const media = (id: string, source: string, target: string): CanvasEdgeLike => ({ id, source, target, sourceHandle: 'output', role: 'REF' })
const mount = (id: string, source: string, target: string): CanvasEdgeLike => ({ id, source, target, sourceHandle: 'interact', role: STORY_MOUNT_ROLE })
const flow = (id: string, source: string, target: string): CanvasEdgeLike => ({ id, source, target, sourceHandle: 'output', role: STORY_FLOW_ROLE })

describe('resolveSceneMedia keeps its exact old behaviour', () => {
  it('prefers the scene own video pick over any linked media', () => {
    expect(resolveSceneMedia('s', scene.data, [scene, video], [media('m', 'v', 's')]))
      .toEqual({ kind: 'video', url: '/s.mp4', posterUrl: '/s.png', durationSec: 6 })
  })

  it('prefers a linked video over a linked image regardless of wire order', () => {
    expect(resolveSceneMedia('s', { title: '空片段' }, [image, video], [media('m1', 'p', 's'), media('m2', 'v', 's')]))
      .toEqual({ kind: 'video', url: '/v.mp4', posterUrl: '/v.png', durationSec: 4.5 })
  })

  it('falls back to a linked image, then to the scene own image, then to null', () => {
    expect(resolveSceneMedia('s', {}, [image], [media('m', 'p', 's')])).toEqual({ kind: 'image', url: '/p.png', posterUrl: '/p.png' })
    expect(resolveSceneMedia('s', { imageUrl: '/own.png' }, [], [])).toEqual({ kind: 'image', url: '/own.png', posterUrl: '/own.png' })
    expect(resolveSceneMedia('s', {}, [], [])).toBeNull()
  })

  it('ignores story flow wires', () => {
    expect(resolveSceneMedia('s', {}, [video], [flow('f', 'v', 's')])).toBeNull()
  })
})

describe('resolveNodeMedia', () => {
  it('excludes mount and flow wires from the picture lookup', () => {
    expect(resolveNodeMedia('i', tap.data, [tap, video], [mount('m', 'v', 'i')], { sceneFields: false })).toBeNull()
    expect(resolveNodeMedia('i', tap.data, [tap, video], [flow('f', 'v', 'i')], { sceneFields: false })).toBeNull()
  })

  it('never reads scene fields off interaction data when sceneFields is false', () => {
    const smuggled = { ...tap, data: { title: '点击', interaction: 'tap', videoUrl: '/smuggled.mp4', imageUrl: '/smuggled.png' } }
    expect(resolveNodeMedia('i', smuggled.data, [smuggled], [], { sceneFields: false })).toBeNull()
    expect(resolveNodeMedia('i', smuggled.data, [smuggled, image], [media('m', 'p', 'i')], { sceneFields: false }))
      .toEqual({ kind: 'image', url: '/p.png', posterUrl: '/p.png' })
  })

  it('defaults to the scene behaviour so the old wrapper stays byte-identical', () => {
    const nodes = [scene, video, image]
    const edges = [media('m1', 'p', 's'), media('m2', 'v', 's')]
    expect(resolveNodeMedia('s', scene.data, nodes, edges)).toEqual(resolveSceneMedia('s', scene.data, nodes, edges))
    expect(resolveNodeMedia('s', { imageUrl: '/own.png' }, nodes, [])).toEqual(resolveSceneMedia('s', { imageUrl: '/own.png' }, nodes, []))
  })
})

describe('compileStoryNode picture and backdrop', () => {
  it('forces picture to null while the interaction is mounted, even with a picture wire', () => {
    const nodes = [scene, tap, video]
    const edges = [mount('m', 's', 'i'), media('mv', 'v', 'i')]
    const compiled = compileStoryNode(tap, nodes, edges) as StoryInteractionNode
    expect(compiled.mountedOn).toBe('s')
    expect(compiled.picture).toBeNull()
  })

  it('gives a standalone interaction the linked video, preferring video over image', () => {
    const nodes = [scene, tap, video, image]
    const edges = [flow('f', 's', 'i'), media('mp', 'p', 'i'), media('mv', 'v', 'i')]
    const compiled = compileStoryNode(tap, nodes, edges) as StoryInteractionNode
    expect(compiled.mountedOn).toBeNull()
    expect(compiled.picture).toEqual({ kind: 'video', url: '/v.mp4', posterUrl: '/v.png', durationSec: 4.5 })
  })

  it('leaves picture null for a standalone interaction without a picture wire', () => {
    const compiled = compileStoryNode(tap, [scene, tap], [flow('f', 's', 'i')]) as StoryInteractionNode
    expect(compiled.picture).toBeNull()
  })

  it('fills a choice backdrop from its picture wire and ignores smuggled scene fields', () => {
    const wired = compileStoryNode(pick, [pick, image], [media('m', 'p', 'c')]) as StoryChoiceNode
    expect(wired.backdrop).toEqual({ kind: 'image', url: '/p.png', posterUrl: '/p.png' })
    const smuggled = { ...pick, data: { ...(pick.data as object), imageUrl: '/smuggled.png' } }
    expect((compileStoryNode(smuggled, [smuggled], []) as StoryChoiceNode).backdrop).toBeNull()
    expect((compileStoryNode(pick, [pick], []) as StoryChoiceNode).backdrop).toBeNull()
  })

  it('compiles scenes exactly as before', () => {
    const compiled = compileStoryNode(scene, [scene, tap, video], [mount('m', 's', 'i'), media('mv', 'v', 's')]) as StorySceneNode
    expect(compiled.media).toEqual({ kind: 'video', url: '/s.mp4', posterUrl: '/s.png', durationSec: 6 })
    expect(compiled.beats.map((beat) => beat.id)).toEqual(['i'])
  })
})
