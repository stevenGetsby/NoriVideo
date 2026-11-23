import { describe, expect, it, vi } from 'vitest'
import { createCanvasChangeTracker } from '@/features/canvas/state/canvas-change-tracker'
import {
  buildCanvasOperations,
  buildCanvasOperationsFromChanges,
  sameOperationTargets,
} from '@/features/canvas/state/canvas-operations'
import type { CanvasDocumentInput, CanvasEdge, CanvasNode, CanvasOperation, Viewport } from '@/features/canvas/types'
import { buildCanvasNodeSummaryV1 } from '@/lib/canvas/graph-summary'

type EditorNode = { id: string; x: number; y: number; text: string }
type EditorEdge = { id: string; source: string; target: string; role: string }

const toNode = (node: EditorNode): CanvasNode => ({
  id: node.id,
  canvasId: 'canvas-1',
  type: 'text',
  position: { x: node.x, y: node.y },
  size: { width: 300, height: 200 },
  data: { text: node.text },
  status: 'IDLE',
  taskId: null,
  runId: null,
  mediaObjectId: null,
  parentNodeId: null,
})

const toEdge = (edge: EditorEdge): CanvasEdge => ({
  id: edge.id,
  canvasId: 'canvas-1',
  sourceNodeId: edge.source,
  targetNodeId: edge.target,
  sourceHandle: null,
  targetHandle: null,
  role: edge.role as CanvasEdge['role'],
})

function documentOf(nodes: readonly EditorNode[], edges: readonly EditorEdge[], viewport: Viewport): CanvasDocumentInput {
  return {
    expectedRevision: 1,
    clientId: 'tab',
    changeSummary: null,
    viewport,
    nodes: nodes.map(toNode),
    edges: edges.map(toEdge),
  }
}

function applyOperations(confirmed: CanvasDocumentInput, operations: readonly CanvasOperation[]): CanvasDocumentInput {
  const nodes = new Map(confirmed.nodes.map((node) => [node.id, node]))
  const edges = new Map(confirmed.edges.map((edge) => [edge.id, edge]))
  let viewport = confirmed.viewport
  for (const operation of operations) {
    if (operation.type === 'node.delete') nodes.delete(operation.id)
    else if (operation.type === 'edge.delete') edges.delete(operation.id)
    else if (operation.type === 'node.upsert') nodes.set(operation.node.id, { ...operation.node, canvasId: 'canvas-1' })
    else if (operation.type === 'edge.add') edges.set(operation.edge.id, { ...operation.edge, canvasId: 'canvas-1' })
    else if (operation.type === 'node.update_geometry') {
      const node = nodes.get(operation.id)
      if (node) nodes.set(operation.id, {
        ...node,
        ...(operation.position ? { position: operation.position } : {}),
        ...(operation.size ? { size: operation.size } : {}),
      })
    } else if (operation.viewport) viewport = operation.viewport
  }
  return { ...confirmed, viewport, nodes: [...nodes.values()], edges: [...edges.values()] }
}

function sortedKeys(_key: string, value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)))
}

function normalized(document: CanvasDocumentInput) {
  return JSON.stringify({
    viewport: document.viewport,
    nodes: [...document.nodes].sort((a, b) => a.id.localeCompare(b.id)),
    edges: [...document.edges].sort((a, b) => a.id.localeCompare(b.id)),
  }, sortedKeys)
}

function random(seed: number) {
  let state = seed
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 2 ** 32
  }
}

describe('canvas change tracker', () => {
  const nodes: EditorNode[] = [{ id: 'a', x: 0, y: 0, text: 'a' }, { id: 'b', x: 1, y: 1, text: 'b' }]
  const edges: EditorEdge[] = [{ id: 'e1', source: 'a', target: 'b', role: 'INPUT_TEXT' }]

  it('reports nothing before a baseline exists', () => {
    const tracker = createCanvasChangeTracker<EditorNode, EditorEdge>()
    expect(tracker.ready()).toBe(false)
    expect(tracker.collect(nodes, edges)).toBeNull()
  })

  it('lists only entities whose reference changed, plus removed ids', () => {
    const tracker = createCanvasChangeTracker<EditorNode, EditorEdge>()
    tracker.reconcile(nodes, edges)
    expect(tracker.collect(nodes, edges)?.changes).toMatchObject({
      dirtyNodeIds: [], removedNodeIds: [], dirtyEdgeIds: [], removedEdgeIds: [],
    })
    const moved = { ...nodes[0], x: 9 }
    const added = { id: 'c', x: 2, y: 2, text: 'c' }
    const batch = tracker.collect([moved, added], [])
    expect(batch?.changes).toMatchObject({
      dirtyNodeIds: ['a', 'c'], removedNodeIds: ['b'], dirtyEdgeIds: [], removedEdgeIds: ['e1'],
    })
    expect(batch?.node('a')).toBe(moved)
    expect(batch?.node('b')).toBeUndefined()
  })

  it('confirms loaded details without rebasing unrelated edits', () => {
    const tracker = createCanvasChangeTracker<EditorNode, EditorEdge>()
    tracker.reconcile(nodes, edges)
    const hydrated = { ...nodes[0], text: '服务端完整正文' }
    const edited = { ...nodes[1], text: '同时发生的本地编辑' }
    tracker.confirmNodes([hydrated])
    const batch = tracker.collect([hydrated, nodes[1]], edges)!
    expect(batch.changes.dirtyNodeIds).toEqual([])
    const later = tracker.collect([hydrated, edited], edges)!
    expect(later.changes.dirtyNodeIds).toEqual(['b'])
  })

  it('advances the baseline only past what a committed batch carried', () => {
    const tracker = createCanvasChangeTracker<EditorNode, EditorEdge>()
    tracker.reconcile(nodes, edges)
    const first = { ...nodes[0], x: 5 }
    const batch = tracker.collect([first, nodes[1]], edges)!
    const editedWhileSaving = { ...first, x: 6 }
    expect(tracker.commit(batch.changes)).toBe(true)
    expect(tracker.collect([first, nodes[1]], edges)?.changes.dirtyNodeIds).toEqual([])
    expect(tracker.collect([editedWhileSaving, nodes[1]], edges)?.changes.dirtyNodeIds).toEqual(['a'])
  })

  it('treats a node deleted and restored with the same reference as dirty until the delete is confirmed', () => {
    const tracker = createCanvasChangeTracker<EditorNode, EditorEdge>()
    tracker.reconcile(nodes, edges)
    const deleted = tracker.collect([nodes[1]], edges)!
    expect(tracker.commit(deleted.changes)).toBe(true)
    expect(tracker.collect(nodes, edges)?.changes.dirtyNodeIds).toEqual(['a'])
  })

  it('discards batches and reconciles from a stale epoch after the baseline was replaced', () => {
    const tracker = createCanvasChangeTracker<EditorNode, EditorEdge>()
    tracker.reconcile(nodes, edges)
    const epoch = tracker.epoch()
    const batch = tracker.collect([{ ...nodes[0], x: 3 }, nodes[1]], edges)!
    tracker.invalidate()
    expect(tracker.ready()).toBe(false)
    expect(tracker.commit(batch.changes)).toBe(false)
    expect(tracker.reconcile(nodes, edges, epoch)).toBe(false)
    expect(tracker.ready()).toBe(false)
    expect(tracker.reconcile(nodes, edges, tracker.epoch())).toBe(true)
    expect(tracker.ready()).toBe(true)
  })

  it('refuses to commit the same batch twice', () => {
    const tracker = createCanvasChangeTracker<EditorNode, EditorEdge>()
    tracker.reconcile(nodes, edges)
    const batch = tracker.collect([{ ...nodes[0], x: 3 }, nodes[1]], edges)!
    expect(tracker.commit(batch.changes)).toBe(true)
    tracker.reconcile(nodes, edges)
    expect(tracker.commit(batch.changes)).toBe(false)
  })
})

describe('incremental operation building', () => {
  const viewport: Viewport = { x: 0, y: 0, zoom: 1 }

  it('sends a single metadata operation for a viewport-only change without converting any entity', () => {
    const nodes: EditorNode[] = Array.from({ length: 50 }, (_, index) => ({ id: `n${index}`, x: index, y: 0, text: 'x' }))
    const confirmed = documentOf(nodes, [], viewport)
    const tracker = createCanvasChangeTracker<EditorNode, EditorEdge>()
    tracker.reconcile(nodes, [])
    const batch = tracker.collect(nodes, [])!
    const node = vi.fn()
    const edge = vi.fn()
    const operations = buildCanvasOperationsFromChanges(
      confirmed,
      { viewport: { x: 10, y: 20, zoom: 0.5 }, node, edge },
      batch.changes,
    )
    expect(operations).toEqual([{ type: 'canvas.update_meta', viewport: { x: 10, y: 20, zoom: 0.5 } }])
    expect(node).not.toHaveBeenCalled()
    expect(edge).not.toHaveBeenCalled()
  })

  it('does nothing for an entity that was re-referenced without changing content', () => {
    const nodes: EditorNode[] = [{ id: 'a', x: 0, y: 0, text: 'a' }]
    const confirmed = documentOf(nodes, [], viewport)
    const tracker = createCanvasChangeTracker<EditorNode, EditorEdge>()
    tracker.reconcile(nodes, [])
    const copy = { ...nodes[0] }
    const batch = tracker.collect([copy], [])!
    const operations = buildCanvasOperationsFromChanges(
      confirmed,
      { viewport, node: () => toNode(copy), edge: () => undefined },
      batch.changes,
    )
    expect(operations).toEqual([])
  })

  it.each([1, 2, 3, 4, 5, 6, 7, 8])('matches the full diff over random edit sessions (seed %i)', (seed) => {
    const next = random(seed)
    const pick = <T,>(items: readonly T[]) => items[Math.floor(next() * items.length)]
    let nodes: EditorNode[] = Array.from({ length: 12 }, (_, index) => ({ id: `n${index}`, x: index, y: index, text: `t${index}` }))
    let edges: EditorEdge[] = Array.from({ length: 8 }, (_, index) => ({
      id: `e${index}`, source: `n${index}`, target: `n${index + 1}`, role: 'INPUT_TEXT',
    }))
    let currentViewport = viewport
    let counter = 100
    let confirmed = documentOf(nodes, edges, currentViewport)
    const tracker = createCanvasChangeTracker<EditorNode, EditorEdge>()
    tracker.reconcile(nodes, edges)
    const removedHistory: EditorNode[] = []

    for (let round = 0; round < 60; round += 1) {
      const steps = 1 + Math.floor(next() * 4)
      for (let step = 0; step < steps; step += 1) {
        const action = Math.floor(next() * 8)
        if (action === 0 && nodes.length) {
          const target = pick(nodes)
          nodes = nodes.map((node) => node === target ? { ...node, x: node.x + 1 } : node)
        } else if (action === 1 && nodes.length) {
          const target = pick(nodes)
          nodes = nodes.map((node) => node === target ? { ...node, text: `${node.text}!` } : node)
        } else if (action === 2) {
          counter += 1
          nodes = [...nodes, { id: `n${counter}`, x: counter, y: 0, text: 'new' }]
        } else if (action === 3 && nodes.length) {
          const target = pick(nodes)
          removedHistory.push(target)
          nodes = nodes.filter((node) => node !== target)
          edges = edges.filter((edge) => edge.source !== target.id && edge.target !== target.id)
        } else if (action === 4 && removedHistory.length) {
          const restored = removedHistory.pop()!
          if (!nodes.some((node) => node.id === restored.id)) nodes = [...nodes, restored]
        } else if (action === 5 && nodes.length > 1) {
          counter += 1
          const [source, target] = [pick(nodes), pick(nodes)]
          edges = [...edges, { id: `e${counter}`, source: source.id, target: target.id, role: 'INPUT_TEXT' }]
        } else if (action === 6 && edges.length) {
          const target = pick(edges)
          edges = edges.map((edge) => edge === target ? { ...edge, role: edge.role === 'REF' ? 'INPUT_TEXT' : 'REF' } : edge)
        } else if (action === 7) {
          currentViewport = { x: currentViewport.x + 1, y: currentViewport.y, zoom: currentViewport.zoom }
        }
        // Re-reference some nodes without touching their content, as selection changes do.
        if (nodes.length && next() < 0.2) {
          const target = pick(nodes)
          nodes = nodes.map((node) => node === target ? { ...node } : node)
        }
      }

      const batch = tracker.collect(nodes, edges)!
      const current = documentOf(nodes, edges, currentViewport)
      const incremental = buildCanvasOperationsFromChanges(
        confirmed,
        {
          viewport: currentViewport,
          node: (id) => { const found = batch.node(id); return found ? toNode(found) : undefined },
          edge: (id) => { const found = batch.edge(id); return found ? toEdge(found) : undefined },
        },
        batch.changes,
      )
      const full = buildCanvasOperations(confirmed, current)
      expect(sameOperationTargets(incremental, full)).toBe(true)

      confirmed = applyOperations(confirmed, incremental)
      expect(normalized(confirmed)).toBe(normalized(current))
      expect(tracker.commit(batch.changes)).toBe(true)
    }
  })
})

  it('moves an unhydrated node without serializing its summary data', () => {
    const confirmed = documentOf([{ id: 'a', x: 0, y: 0, text: 'full original text' }], [], { x: 0, y: 0, zoom: 1 })
    const summary = buildCanvasNodeSummaryV1(confirmed.nodes[0]!)
    const moved = {
      ...summary,
      position: { x: 40, y: 80 },
      data: { ...summary.data, __canvasUnhydrated: true },
    }
    expect(buildCanvasOperations(confirmed, { ...confirmed, nodes: [moved] }, { geometryOps: true })).toEqual([
      { type: 'node.update_geometry', id: 'a', position: { x: 40, y: 80 } },
    ])
    const hydrated = { ...confirmed.nodes[0], position: { x: 40, y: 80 } }
    expect(buildCanvasOperations(confirmed, { ...confirmed, nodes: [hydrated] }, { geometryOps: true })).toEqual([
      { type: 'node.update_geometry', id: 'a', position: { x: 40, y: 80 } },
    ])
  })

  it('does nothing when an unhydrated node keeps its position and size', () => {
    const confirmed = documentOf([{ id: 'a', x: 0, y: 0, text: 'full original text' }], [], { x: 0, y: 0, zoom: 1 })
    const projected = buildCanvasNodeSummaryV1(confirmed.nodes[0]!)
    const summary = { ...projected, data: { ...projected.data, __canvasUnhydrated: true } }
    expect(buildCanvasOperations(confirmed, { ...confirmed, nodes: [summary] }, { geometryOps: true })).toEqual([])
  })

  it('rejects a summary shell outside the geometry-only protocol', () => {
    const confirmed = documentOf([{ id: 'a', x: 0, y: 0, text: 'full original text' }], [], { x: 0, y: 0, zoom: 1 })
    const summary = { ...confirmed.nodes[0], data: { title: 'summary', __canvasUnhydrated: true } }
    expect(() => buildCanvasOperations(confirmed, { ...confirmed, nodes: [summary] })).toThrow(/尚未加载/)
  })

describe('operation target comparison', () => {
  it('ignores order but not multiplicity or entity', () => {
    const a: CanvasOperation = { type: 'node.delete', id: 'a' }
    const b: CanvasOperation = { type: 'edge.delete', id: 'a' }
    expect(sameOperationTargets([a, b], [b, a])).toBe(true)
    expect(sameOperationTargets([a, a], [a, b])).toBe(false)
    expect(sameOperationTargets([a], [a, b])).toBe(false)
    expect(sameOperationTargets(
      [{ type: 'canvas.update_meta', viewport: { x: 1, y: 1, zoom: 1 } }],
      [{ type: 'canvas.update_meta', viewport: { x: 2, y: 2, zoom: 1 } }],
    )).toBe(true)
  })
})
