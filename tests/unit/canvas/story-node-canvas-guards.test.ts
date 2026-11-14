import { describe, expect, it } from 'vitest'
import { filterStoryClipboardDocument } from '@/features/canvas/clipboard'
import { isCanvasConnectionAllowed, planCanvasBatchConnections } from '@/features/canvas/batch-node-connection'
import type { CanvasFlowEdge, CanvasFlowNode } from '@/features/canvas/editor-types'
import { STORY_MOUNT_ROLE } from '@/lib/interactive/types'

function node(id: string, type: string, data: Partial<CanvasFlowNode['data']> = {}): CanvasFlowNode {
  return { id, type, position: { x: 0, y: 0 }, data: { title: id, ...data } }
}

function mountEdge(sceneId: string, interactionId: string): CanvasFlowEdge {
  return {
    id: `${sceneId}-${interactionId}`,
    source: sceneId,
    target: interactionId,
    sourceHandle: 'interaction',
    targetHandle: 'mount',
    data: { role: STORY_MOUNT_ROLE },
  }
}

describe('plain canvases keep story nodes and wires out', () => {
  it('drops story nodes and the mount wire from a pasted canvas document', () => {
    const nodes = [
      node('scene', 'story_scene'),
      node('interaction', 'story_interaction'),
      node('image', 'image', { mediaType: 'image' }),
    ]
    const edges = [mountEdge('scene', 'interaction')]

    const plain = filterStoryClipboardDocument(nodes, edges, false)
    expect(plain.filtered).toBe(true)
    expect(plain.nodes.map((item) => item.id)).toEqual(['image'])
    expect(plain.edges).toEqual([])

    const story = filterStoryClipboardDocument(nodes, edges, true)
    expect(story.filtered).toBe(false)
    expect(story.nodes).toHaveLength(3)
    expect(story.edges).toHaveLength(1)
  })

  it('rejects mount wires and story sources even when the other end is a media node', () => {
    const nodes = [
      node('scene', 'story_scene'),
      node('interaction', 'story_interaction'),
      node('video', 'video', { mediaType: 'video' }),
      node('video2', 'video', { mediaType: 'video' }),
    ]
    const mount = { source: 'scene', target: 'interaction', sourceHandle: 'interaction', targetHandle: 'mount' }
    expect(isCanvasConnectionAllowed(mount, nodes, [])).toBe(true)
    expect(isCanvasConnectionAllowed(mount, nodes, [], 4000, false)).toBe(false)

    const storyToVideo = { source: 'interaction', target: 'video', sourceHandle: 'output', targetHandle: 'input' }
    expect(isCanvasConnectionAllowed(storyToVideo, nodes, [], 4000, false)).toBe(false)

    const result = planCanvasBatchConnections({
      nodes,
      edges: [],
      sourceNodeIds: ['interaction', 'video'],
      targetNodeId: 'video2',
      allowStory: false,
      createId: () => 'new-edge',
    })
    expect(result.added).toBe(1)
    expect(result.skipped).toBe(1)
    expect(result.edges.map((edge) => [edge.source, edge.target])).toEqual([['video', 'video2']])
  })
})
