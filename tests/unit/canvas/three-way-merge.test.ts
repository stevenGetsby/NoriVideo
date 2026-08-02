import { describe, expect, it } from 'vitest'
import { mergeCanvasDocuments } from '@/features/canvas/state/canvas-three-way-merge'
import type { CanvasDocumentInput, CanvasEdge, CanvasNode } from '@/features/canvas/types'

function node(id: string, data: Record<string, unknown>, x = 0): CanvasNode {
  return {
    id,
    canvasId: 'canvas-1',
    type: 'image',
    position: { x, y: 0 },
    size: { width: 300, height: 200 },
    data,
    status: 'IDLE',
    taskId: null,
    runId: null,
    mediaObjectId: null,
    parentNodeId: null,
  }
}

function edge(id: string, sourceNodeId: string, targetNodeId: string): CanvasEdge {
  return { id, canvasId: 'canvas-1', sourceNodeId, targetNodeId, sourceHandle: null, targetHandle: null, role: 'INPUT_DEFAULT' }
}

function document(revision: number, nodes: CanvasNode[], edges: CanvasEdge[] = []): CanvasDocumentInput {
  return { schema_version: 1, expectedRevision: revision, clientId: `client-${revision}`, viewport: { x: 0, y: 0, zoom: 1 }, nodes, edges }
}

describe('canvas sibling-tab three-way merge', () => {
  it('keeps independent node and field edits from both tabs', () => {
    const base = document(3, [node('a', { title: 'A', prompt: 'old' }), node('b', { title: 'B' })])
    const local = document(3, [node('a', { title: 'A local', prompt: 'old' }), node('b', { title: 'B' })])
    const remote = document(4, [node('a', { title: 'A', prompt: 'remote prompt' }), node('b', { title: 'B remote' })])
    const merged = mergeCanvasDocuments(base, local, remote)

    expect(merged.expectedRevision).toBe(4)
    expect(merged.clientId).toBe(local.clientId)
    expect(merged.nodes.find((item) => item.id === 'a')?.data).toMatchObject({ title: 'A local', prompt: 'remote prompt' })
    expect(merged.nodes.find((item) => item.id === 'b')?.data).toMatchObject({ title: 'B remote' })
  })

  it('keeps both additions and applies non-conflicting deletions', () => {
    const base = document(2, [node('keep', { title: 'keep' }), node('delete-local', {}), node('delete-remote', {})])
    const local = document(2, [node('keep', { title: 'keep' }), node('delete-remote', {}), node('local-new', {})])
    const remote = document(3, [node('keep', { title: 'keep' }), node('delete-local', {}), node('remote-new', {})])
    const ids = mergeCanvasDocuments(base, local, remote).nodes.map((item) => item.id)

    expect(ids).toContain('keep')
    expect(ids).toContain('local-new')
    expect(ids).toContain('remote-new')
    expect(ids).not.toContain('delete-local')
    expect(ids).not.toContain('delete-remote')
  })

  it('preserves the edited side of delete-versus-edit conflicts and removes dangling edges', () => {
    const base = document(1, [node('a', { title: 'A' }), node('b', { title: 'B' })], [edge('a-b', 'a', 'b')])
    const local = document(1, [node('b', { title: 'B' })], [])
    const remote = document(2, [node('a', { title: 'A remote' })], [edge('a-b', 'a', 'b')])
    const merged = mergeCanvasDocuments(base, local, remote)

    expect(merged.nodes).toHaveLength(1)
    expect(merged.nodes[0]).toMatchObject({ id: 'a', data: { title: 'A remote' } })
    expect(merged.edges).toEqual([])
  })

  it('uses the active tab only for a true same-field conflict', () => {
    const base = document(5, [node('a', { prompt: 'base' })])
    const local = document(5, [node('a', { prompt: 'local' })])
    const remote = document(6, [node('a', { prompt: 'remote' })])
    expect(mergeCanvasDocuments(base, local, remote).nodes[0].data?.prompt).toBe('local')
  })
})
