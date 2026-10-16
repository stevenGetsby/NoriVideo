import { describe, expect, it } from 'vitest'
import { isCanvasConnectionAllowed, planCanvasBatchConnections } from '@/features/canvas/batch-node-connection'
import type { CanvasFlowEdge, CanvasFlowNode } from '@/features/canvas/editor-types'
import type { CanvasGenerationInputSchema } from '@/lib/canvas/generation-input-schema'
import { CANVAS_PLAYLIST_MAX_ITEMS } from '@/lib/canvas/playlist'

function node(id: string, type = 'image', patch: Partial<CanvasFlowNode['data']> = {}): CanvasFlowNode {
  return { id, type, position: { x: 100, y: 100 }, data: { title: id, mediaType: type === 'video_edit' ? 'video' : type === 'model_3d' ? 'model3d' : type as 'image', origin: 'generate', ...patch } }
}
function edge(source: string, target: string): CanvasFlowEdge {
  return { id: `${source}-${target}`, source, target, sourceHandle: 'output', targetHandle: 'input', data: { role: 'INPUT_DEFAULT' } }
}
function plan(nodes: CanvasFlowNode[], sources: string[], target = 'target', edges: CanvasFlowEdge[] = [], maxEdges?: number) {
  let next = 0
  return planCanvasBatchConnections({ nodes, sourceNodeIds: sources, targetNodeId: target, edges, maxEdges, createId: () => `new-${++next}` })
}

describe('canvas batch node connections', () => {
  it('connects all selected images to one video without moving or mutating the source nodes', () => {
    const nodes = [node('a'), node('b'), node('c'), node('target', 'video')]
    const initial = structuredClone(nodes)
    const result = plan(nodes, ['a', 'b', 'c'])
    expect(result.added).toBe(3)
    expect(result.skipped).toBe(0)
    expect(result.edges.map((item) => [item.source, item.target])).toEqual([['a', 'target'], ['b', 'target'], ['c', 'target']])
    expect(result.edges.every((item) => item.sourceHandle === 'output' && item.targetHandle === 'input')).toBe(true)
    expect(nodes).toEqual(initial)
    expect(result.nodes.filter((item) => item.id !== 'target')).toEqual(initial.filter((item) => item.id !== 'target'))
    expect(result.nodes.find((item) => item.id === 'target')?.data.generation?.referenceNodeIds).toEqual(['a', 'b', 'c'])
  })
  it('adds connected media to the target generator reference ids for generation', () => {
    const nodes = [node('a'), node('b'), node('target', 'video', { generation: { referenceNodeIds: [] } })]
    const result = plan(nodes, ['a', 'b'])
    expect(result.nodes.find((item) => item.id === 'target')?.data.generation?.referenceNodeIds).toEqual(['a', 'b'])
  })
  it('does not re-enable earlier inputs explicitly deselected by the user', () => {
    const nodes = [node('old'), node('new'), node('target', 'video', { generation: { referenceNodeIds: [] } })]
    const result = plan(nodes, ['new'], 'target', [edge('old', 'target')])
    expect(result.nodes.find((item) => item.id === 'target')?.data.generation?.referenceNodeIds).toEqual(['new'])
  })
  it('does not reserve input slots for wires explicitly deselected from generation', () => {
    const target = node('target', 'video', { generation: { inputMode: 'firstlastframe', referenceNodeIds: [] } })
    const result = plan([node('old-a'), node('old-b'), node('a'), node('b'), target], ['a', 'b'], 'target',
      [edge('old-a', 'target'), edge('old-b', 'target')])
    expect(result.added).toBe(2)
    expect(result.nodes.at(-1)?.data.generation?.referenceNodeIds).toEqual(['a', 'b'])
  })
  it('deduplicates selected ids and skips self, missing and previously connected nodes', () => {
    const nodes = [node('a'), node('b'), node('target', 'video')]
    const originalEdges = [edge('a', 'target')]
    const result = plan(nodes, ['a', 'a', 'b', 'target', 'gone'], 'target', originalEdges)
    expect(result).toMatchObject({ added: 1, skipped: 3 })
    expect(originalEdges).toHaveLength(1)
    expect(result.edges).toHaveLength(2)
  })
  it('does not connect to uploads, groups or incompatible node types', () => {
    const source = node('source', 'image')
    for (const target of [node('target', 'image', { origin: 'upload' }), node('target', 'group'), node('target', 'text')]) {
      expect(plan([source, target], ['source'])).toMatchObject({ added: 0, skipped: 1 })
    }
    expect(plan([node('group', 'group'), node('video', 'video'), node('audio', 'audio'), node('target')], ['group', 'video', 'audio']))
      .toMatchObject({ added: 0, skipped: 3 })
  })
  it('prevents indirect cycles and reverse duplicate wires while preserving compatible sources', () => {
    const nodes = [node('a', 'video'), node('b', 'video'), node('via', 'video'), node('target', 'video')]
    const result = plan(nodes, ['a', 'b'], 'target', [edge('target', 'via'), edge('via', 'a')])
    expect(result).toMatchObject({ added: 1, skipped: 1 })
    expect(result.edges.at(-1)?.source).toBe('b')
    expect(isCanvasConnectionAllowed({ source: 'via', target: 'target' }, nodes, [edge('target', 'via')])).toBe(false)
  })
  it('checks capacity across the entire batch rather than independently for every wire', () => {
    const result = plan([node('a'), node('b'), node('c'), node('target', 'video')], ['a', 'b', 'c'], 'target', [], 2)
    expect(result).toMatchObject({ added: 2, skipped: 1 })
    expect(result.edges).toHaveLength(2)
  })
  it('respects existing picker references and first/last-frame limits without double counting', () => {
    const target = node('target', 'video', { generation: { inputMode: 'firstlastframe', referenceNodeIds: ['a'] } })
    const result = plan([node('a'), node('b'), node('c'), target], ['a', 'b', 'c'])
    expect(result).toMatchObject({ added: 2, skipped: 1 })
    expect(result.edges.map((item) => item.source)).toEqual(['a', 'b'])
  })
  it('keeps independent image/video/audio model limits and permits text prompt inputs', () => {
    const inputSchema: CanvasGenerationInputSchema = {
      image: { min: 0, max: 2 }, video: { min: 0, max: 1 }, audio: { min: 0, max: 0 }, requiredFields: ['prompt'],
    }
    const nodes = [node('existing'), node('a'), node('b'), node('v1', 'video'), node('v2', 'video'), node('audio', 'audio'), node('text', 'text'), node('3d', 'model_3d'), node('target', 'video', { generation: { inputSchema } })]
    const result = plan(nodes, ['a', 'b', 'v1', 'v2', 'audio', 'text', '3d'], 'target', [edge('existing', 'target')])
    expect(result).toMatchObject({ added: 3, skipped: 4 })
    expect(result.edges.slice(1).map((item) => item.source)).toEqual(['a', 'v1', 'text'])
  })
  it('skips incompatible audio while accepting images for image-to-video input mode', () => {
    const target = node('target', 'video', { generation: { inputMode: 'image' } })
    expect(plan([node('a'), node('b'), node('audio', 'audio'), target], ['a', 'audio', 'b']))
      .toMatchObject({ added: 2, skipped: 1 })
  })
  it('adds multiple ready videos to a playlist in selection order and skips unfinished clips', () => {
    const nodes = [node('a', 'video', { videoUrl: 'a.mp4' }), node('pending', 'video'), node('b', 'video', { videoUrl: 'b.mp4' }), node('target', 'playlist')]
    const result = plan(nodes, ['a', 'pending', 'b'])
    expect(result).toMatchObject({ added: 2, skipped: 1 })
    expect(result.nodes.at(-1)?.data.playlistItems?.map((item) => item.sourceNodeId)).toEqual(['a', 'b'])
    expect(nodes.at(-1)?.data.playlistItems).toBeUndefined()
  })
  it('enforces playlist capacity without adding orphan edges', () => {
    const playlistItems = Array.from({ length: CANVAS_PLAYLIST_MAX_ITEMS }, (_, i) => ({ id: `clip-${i}`, title: `${i}`, sourceNodeId: `source-${i}`, videoUrl: 'clip.mp4', sourceInMs: 0 }))
    const result = plan([node('a', 'video', { videoUrl: 'a.mp4' }), node('target', 'playlist', { playlistItems })], ['a'])
    expect(result).toMatchObject({ added: 0, skipped: 1, edges: [] })
  })
  it('does not overwrite a video editor source with the last selected video', () => {
    const result = plan([node('a', 'video', { videoUrl: 'a.mp4' }), node('b', 'video', { videoUrl: 'b.mp4' }), node('target', 'video_edit')], ['a', 'b'])
    expect(result).toMatchObject({ added: 1, skipped: 1 })
    expect(result.nodes.at(-1)?.data.videoEdit?.sourceNodeId).toBe('a')
    expect(result.nodes.at(-1)?.data.videoUrl).toBe('a.mp4')
    const retained = plan(result.nodes, ['b'], 'target', result.edges)
    expect(retained.added).toBe(0)
    expect(retained.nodes.at(-1)?.data.videoEdit?.sourceNodeId).toBe('a')
  })
  it('preserves left-handle direction for single-node connections', () => {
    const nodes = [node('source'), node('target', 'video')]
    expect(isCanvasConnectionAllowed({ source: 'target', target: 'source', sourceHandle: 'input', targetHandle: 'output' }, nodes, [])).toBe(true)
    expect(isCanvasConnectionAllowed({ source: 'source', target: 'target', sourceHandle: 'input', targetHandle: 'input' }, nodes, [])).toBe(false)
  })
})
