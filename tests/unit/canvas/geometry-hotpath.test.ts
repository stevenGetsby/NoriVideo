import { expect, it, vi } from 'vitest'
import type { CanvasDocumentInput, CanvasNode } from '@/features/canvas/types'
import { buildCanvasOperationsFromChanges } from '@/features/canvas/state/canvas-operations'

const { projection } = vi.hoisted(() => ({ projection: vi.fn() }))
vi.mock('@/lib/canvas/graph-summary', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/canvas/graph-summary')>()
  return { ...actual, projectCanvasNodeCardData: (...args: Parameters<typeof actual.projectCanvasNodeCardData>) => {
    projection()
    return actual.projectCanvasNodeCardData(...args)
  } }
})

it('moves a batch of unchanged summary bodies without rebuilding or serializing card projections', () => {
  projection.mockClear()
  const originals = Array.from({ length: 55 }, (_, index): CanvasNode => ({
    id: `fixture-${index}`, canvasId: 'canvas-fixture', type: 'video',
    position: { x: index, y: 0 }, size: { width: 200, height: 100 },
    data: { mediaType: 'video', title: '合成节点', generation: { modelKey: 'fixture', referenceNodeIds: ['linked'] } },
    status: 'IDLE', taskId: null, runId: null, mediaObjectId: null, parentNodeId: null,
  }))
  const viewport = { x: 0, y: 0, zoom: 1 }
  const confirmed: CanvasDocumentInput = { expectedRevision: 0, clientId: 'fixture', viewport, nodes: originals, edges: [] }
  const moved = new Map(originals.map((node) => [node.id, {
    ...node, position: { x: node.position.x + 10, y: 5 },
    data: { ...node.data, __canvasUnhydrated: true },
  }]))
  const changes = { epoch: 0, dirtyNodeIds: [...moved.keys()], removedNodeIds: [], dirtyEdgeIds: [], removedEdgeIds: [] }
  const view = { viewport, node: (id: string) => moved.get(id), edge: () => undefined }
  const operations = buildCanvasOperationsFromChanges(confirmed, view, changes, { geometryOps: true })
  expect(operations).toEqual(originals.map((node) => ({
    type: 'node.update_geometry', id: node.id, position: { x: node.position.x + 10, y: 5 },
  })))
  expect(projection).not.toHaveBeenCalled()
  const id = originals[0].id
  const first = moved.get(id)!
  moved.set(id, { ...first, data: { ...first.data, generation: { modelKey: 'new-model', referenceNodeIds: ['linked'] } } })
  expect(buildCanvasOperationsFromChanges(confirmed, view, { ...changes, dirtyNodeIds: [id] }, { geometryOps: true })[0])
    .toMatchObject({ type: 'node.upsert', node: { data: { generation: { modelKey: 'new-model' } } } })
  expect(projection).toHaveBeenCalled()
})
