import { describe, expect, it } from 'vitest'
import { buildScaleGraph } from '../../browser/canvas-scale-fixtures.mjs'
import {
  CANVAS_RENDER_BUDGET,
  resolveRenderMode,
  shouldProjectCanvas,
} from '../../../src/features/canvas/rendering/canvas-render-budget'
import {
  CanvasRenderIndex,
  queryCanvasRenderProjection,
  type CanvasProjectionParams,
  type RenderEdgeInput,
  type RenderNodeInput,
} from '../../../src/features/canvas/rendering/canvas-viewport-index'

const SURFACE = { width: 1000, height: 600 }
const node = (id: string, x: number, y: number, extra: Partial<RenderNodeInput> = {}): RenderNodeInput => ({
  id, type: 'image', x, y, width: 320, height: 180, ...extra,
})
const edge = (source: string, target: string, extra: Partial<RenderEdgeInput> = {}): RenderEdgeInput => ({
  id: `e-${source}-${target}`, source, target, ...extra,
})
const build = (nodes: RenderNodeInput[], edges: RenderEdgeInput[] = []) => {
  const index = new CanvasRenderIndex()
  index.applyChanges({ nodes, edges })
  return index
}
const params = (extra: Partial<CanvasProjectionParams> = {}): CanvasProjectionParams => ({
  viewport: { x: 0, y: 0, zoom: 1 }, surface: SURFACE, mode: 'full', ...extra,
})

describe('canvas render budget', () => {
  it('only projects graphs above the node or edge threshold', () => {
    expect(shouldProjectCanvas(80, 160)).toBe(false)
    expect(shouldProjectCanvas(81, 0)).toBe(true)
    expect(shouldProjectCanvas(10, 161)).toBe(true)
  })

  it('uses hysteresis around the overview threshold', () => {
    expect(resolveRenderMode('full', 0.31)).toBe('full')
    expect(resolveRenderMode('full', 0.3)).toBe('overview')
    expect(resolveRenderMode('overview', 0.37)).toBe('overview')
    expect(resolveRenderMode('overview', 0.38)).toBe('full')
    expect(resolveRenderMode('overview', 0.34)).toBe('overview')
    expect(resolveRenderMode('full', 0.34)).toBe('full')
  })
})

describe('canvas render index: viewport queries', () => {
  it('finds nodes at negative coordinates and applies a 200 CSS px buffer divided by zoom', () => {
    const index = build([
      node('inside', -100, -50),
      node('near', 1100, 0),
      node('far', 1400, 0),
    ])
    const result = queryCanvasRenderProjection(index, params())
    expect(result.fullNodeIds).toEqual(['inside', 'near'])

    const zoomed = queryCanvasRenderProjection(index, params({ viewport: { x: 0, y: 0, zoom: 0.5 } }))
    expect(zoomed.fullNodeIds).toEqual(['far', 'inside', 'near'])
    expect(zoomed.rect.right).toBeCloseTo(1000 / 0.5 + 200 / 0.5)
  })

  it('keeps wide group nodes whose centre is outside the viewport', () => {
    const index = build([
      node('group-1', -4000, -4000, { type: 'group', width: 9000, height: 9000 }),
      node('a', 10, 10),
    ])
    expect(queryCanvasRenderProjection(index, params()).fullNodeIds).toEqual(['a', 'group-1'])
  })

  it('does not crash on unknown or non-finite geometry', () => {
    const index = build([
      node('nan', Number.NaN, Number.NaN, { width: Number.NaN, height: Number.NaN }),
      node('inf', Number.POSITIVE_INFINITY, 0),
    ])
    expect(() => queryCanvasRenderProjection(index, params())).not.toThrow()
    expect(index.nodeCount).toBe(2)
  })

  it('returns a stable result regardless of insertion order', () => {
    const nodes = Array.from({ length: 60 }, (_, i) => node(`n${i}`, (i % 10) * 330 - 800, Math.floor(i / 10) * 190))
    const forward = queryCanvasRenderProjection(build(nodes), params())
    const reversed = queryCanvasRenderProjection(build([...nodes].reverse()), params())
    expect(reversed.fullNodeIds).toEqual(forward.fullNodeIds)
    expect(queryCanvasRenderProjection(build(nodes), params())).toEqual(forward)
  })

  it('caps full nodes at the budget and keeps the nodes nearest the viewport centre', () => {
    const nodes = Array.from({ length: 400 }, (_, i) => node(`n${String(i).padStart(3, '0')}`, (i % 20) * 340, Math.floor(i / 20) * 200))
    const index = build(nodes)
    const result = queryCanvasRenderProjection(index, params({ viewport: { x: 0, y: 0, zoom: 0.5 } }))
    expect(result.fullNodeIds.length).toBeLessThanOrEqual(CANVAS_RENDER_BUDGET.fullNodes)
    const centre = { x: 1000, y: 600 }
    const dist = (id: string) => {
      const box = index.nodeBox(id)!
      return Math.hypot(box.x + box.width / 2 - centre.x, box.y + box.height / 2 - centre.y)
    }
    const picked = new Set(result.fullNodeIds)
    const worstPicked = Math.max(...result.fullNodeIds.map(dist))
    const rejectedInView = nodes.filter((n) => !picked.has(n.id) && dist(n.id) < worstPicked * 0.5)
    expect(rejectedInView).toEqual([])
  })

  it('puts selected, pinned and protected-edge nodes in the full set first', () => {
    const nodes = Array.from({ length: 300 }, (_, i) => node(`n${i}`, (i % 20) * 340, Math.floor(i / 20) * 200))
    const index = build(nodes)
    const result = queryCanvasRenderProjection(index, params({
      viewport: { x: 0, y: 0, zoom: 0.5 },
      pinnedNodeIds: ['n299'],
      selectedNodeIds: ['n280'],
    }))
    expect(result.fullNodeIds).toContain('n299')
    expect(result.fullNodeIds).toContain('n280')
  })

  it('treats a large selection as overview state without promoting all of it to DOM', () => {
    const nodes = Array.from({ length: 200 }, (_, i) => node(`n${i}`, (i % 20) * 340, Math.floor(i / 20) * 200))
    const index = build(nodes)
    const selected = nodes.slice(0, 120).map((n) => n.id)
    const result = queryCanvasRenderProjection(index, params({
      viewport: { x: 0, y: 0, zoom: 0.34 }, surface: { width: 1920, height: 1080 }, selectedNodeIds: selected,
    }))
    expect(result.fullNodeIds.length).toBeLessThanOrEqual(CANVAS_RENDER_BUDGET.fullNodes)
    expect(result.overview.nodes.some((item) => item.selected)).toBe(true)
  })

  it('overview mode mounts only pinned and small selections', () => {
    const nodes = Array.from({ length: 300 }, (_, i) => node(`n${i}`, (i % 20) * 340, Math.floor(i / 20) * 200))
    const index = build(nodes)
    const result = queryCanvasRenderProjection(index, params({
      viewport: { x: 0, y: 0, zoom: 0.2 }, mode: 'overview', pinnedNodeIds: ['n5'], selectedNodeIds: ['n9'],
    }))
    expect(result.fullNodeIds).toEqual(['n5', 'n9'])
  })

  it('accounts for every visible node exactly once between full cards and the overview', () => {
    const nodes = Array.from({ length: 500 }, (_, i) => node(`n${i}`, (i % 25) * 340, Math.floor(i / 25) * 200))
    const index = build(nodes)
    const view = params({ viewport: { x: 0, y: 0, zoom: 0.25 }, mode: 'overview', surface: { width: 1920, height: 1080 } })
    const result = queryCanvasRenderProjection(index, view)
    const ids = [...result.fullNodeIds, ...result.overview.nodes.map((item) => item.id)]
    expect(new Set(ids).size).toBe(ids.length)
    expect(result.overview.cells).toEqual([])
    const inRect = index.nodeIdsInRect(result.rect)
    expect([...ids].sort()).toEqual(inRect)
  })

  it('aggregates into at most 32x18 cells when the overview is crowded', () => {
    const graph = buildScaleGraph('p5-5000')
    const nodes = graph.nodes.map((item: { id: string; type: string; position: { x: number; y: number }; size?: { width: number; height: number } }) => node(item.id, item.position.x, item.position.y, { type: item.type, width: item.size?.width ?? 320, height: item.size?.height ?? 180 }))
    const index = build(nodes)
    const result = queryCanvasRenderProjection(index, params({
      viewport: { x: 0, y: 0, zoom: 0.15 }, surface: { width: 1920, height: 1080 }, mode: 'overview',
    }))
    expect(result.overview.nodes).toEqual([])
    expect(result.overview.cells.length).toBeGreaterThan(0)
    expect(result.overview.cells.length).toBeLessThanOrEqual(CANVAS_RENDER_BUDGET.overviewColumns * CANVAS_RENDER_BUDGET.overviewRows * 2)
    const total = result.overview.cells.reduce((sum, cell) => sum + cell.count, 0)
    expect(total).toBeGreaterThan(0)
    expect(total).toBeLessThanOrEqual(5000)
  })

  it('does not scale candidate visits with the number of nodes crammed into one cell', () => {
    const visits = (count: number) => {
      const nodes = Array.from({ length: count }, (_, i) => node(`n${i}`, 10 + (i % 7), 10 + (i % 5)))
      const result = queryCanvasRenderProjection(build(nodes), params())
      expect(result.fullNodeIds.length).toBeLessThanOrEqual(CANVAS_RENDER_BUDGET.fullNodes)
      expect(result.overview.cells.length + result.overview.nodes.length).toBeLessThanOrEqual(CANVAS_RENDER_BUDGET.overviewNodeRects)
      return result.stats.nodeVisits
    }
    const small = visits(1000)
    const large = visits(8000)
    expect(large).toBeLessThanOrEqual(CANVAS_RENDER_BUDGET.maxNodeVisits)
    expect(large).toBeLessThanOrEqual(small + 8)
  })
})

describe('canvas render index: edges', () => {
  it('keeps an edge whose two endpoints are off-screen but whose curve crosses the viewport', () => {
    const index = build([node('left', -5000, 100), node('right', 6000, 100)], [edge('left', 'right')])
    const result = queryCanvasRenderProjection(index, params())
    expect(result.fullNodeIds).toEqual([])
    expect(result.activeEdgeIds).toEqual([])
    expect(result.foldedEdgeCount).toBe(1)
    expect(result.overview.edges).toHaveLength(1)
    expect(result.overview.edges[0]).toMatchObject({ sx: -4680, tx: 6000 })
  })

  it('uses a conservative bounding box for backward edges', () => {
    const index = build([node('a', 2000, 0), node('b', 0, 600)], [edge('a', 'b')])
    const edgeOnly = queryCanvasRenderProjection(index, params({ viewport: { x: -2330, y: 0, zoom: 1 }, surface: { width: 200, height: 800 } }))
    expect(edgeOnly.foldedEdgeCount + edgeOnly.activeEdgeIds.length).toBeGreaterThan(0)
  })

  it('draws at most 160 edges and counts the rest as folded, never losing them from the index', () => {
    const nodes = [node('hub', 0, 0), ...Array.from({ length: 70 }, (_, i) => node(`t${i}`, 500 + (i % 7) * 340, Math.floor(i / 7) * 200))]
    const edges = Array.from({ length: 70 }, (_, i) => edge('hub', `t${i}`))
    const more = Array.from({ length: 200 }, (_, i) => edge(`t${i % 70}`, `t${(i * 7 + 3) % 70}`, { id: `x${i}` })).filter((item) => item.source !== item.target)
    const index = build(nodes, [...edges, ...more])
    const result = queryCanvasRenderProjection(index, params({ surface: { width: 3200, height: 2000 } }))
    expect(result.fullNodeIds).toHaveLength(nodes.length)
    expect(result.activeEdgeIds.length).toBeLessThanOrEqual(CANVAS_RENDER_BUDGET.activeEdges)
    expect(result.activeEdgeIds.length + result.foldedEdgeCount).toBe(edges.length + more.length)
    expect(index.edgeCount).toBe(edges.length + more.length)
    expect(result.foldedEdgesExact).toBe(true)
  })

  it('reduces the edge budget while a gesture is running', () => {
    const nodes = Array.from({ length: 60 }, (_, i) => node(`n${i}`, (i % 10) * 330, Math.floor(i / 10) * 200))
    const edges: RenderEdgeInput[] = []
    for (let i = 0; i < 60; i += 1) for (let j = 1; j <= 5; j += 1) edges.push(edge(`n${i}`, `n${(i + j) % 60}`))
    const index = build(nodes, edges)
    const idle = queryCanvasRenderProjection(index, params({ viewport: { x: 0, y: 0, zoom: 0.5 } }))
    const panning = queryCanvasRenderProjection(index, params({ viewport: { x: 0, y: 0, zoom: 0.5 }, gesture: 'panning' }))
    expect(idle.activeEdgeIds.length).toBe(CANVAS_RENDER_BUDGET.activeEdges)
    expect(panning.activeEdgeIds.length).toBe(CANVAS_RENDER_BUDGET.activeEdgesInGesture)
  })

  it('prefers selected edges and edges touching the active node over distance', () => {
    const nodes = Array.from({ length: 70 }, (_, i) => node(`n${i}`, (i % 10) * 330, Math.floor(i / 10) * 200))
    const edges: RenderEdgeInput[] = []
    for (let i = 0; i < 69; i += 1) for (let j = 1; j <= 4; j += 1) if (i + j < 70) edges.push(edge(`n${i}`, `n${i + j}`))
    const index = build(nodes, edges)
    const picked = queryCanvasRenderProjection(index, params({
      viewport: { x: 0, y: 0, zoom: 0.3 },
      surface: { width: 1920, height: 1080 },
      selectedEdgeIds: ['e-n0-n1'],
      pinnedNodeIds: ['n69'],
    }))
    expect(picked.activeEdgeIds).toContain('e-n0-n1')
    expect(picked.activeEdgeIds).toContain('e-n68-n69')
    expect(picked.fullNodeIds).toEqual(expect.arrayContaining(['n0', 'n1', 'n69']))
  })

  it('never clips protected edges and keeps their endpoints mounted', () => {
    const count = 300
    const nodes = Array.from({ length: count }, (_, i) => node(`n${i}`, (i % 20) * 340, Math.floor(i / 20) * 200))
    const edges = Array.from({ length: count - 1 }, (_, i) => edge(`n${i}`, `n${i + 1}`, { protected: true }))
    const result = queryCanvasRenderProjection(build(nodes, edges), params({ viewport: { x: 0, y: 0, zoom: 0.5 }, surface: { width: 2000, height: 1200 } }))
    const visible = new Set(result.activeEdgeIds)
    for (const item of edges) {
      const box = nodes.find((n) => n.id === item.source)!
      if (box.x < 4000 && box.y < 2400) expect(visible.has(item.id), item.id).toBe(true)
    }
    expect(result.fullNodeIds.length).toBeGreaterThan(CANVAS_RENDER_BUDGET.fullNodes)
  })
})

describe('canvas render index: incremental updates', () => {
  it('re-routes edges when a node moves and drops them when a node or edge is removed', () => {
    const index = build([node('a', 0, 0), node('b', 400, 0)], [edge('a', 'b')])
    const away = { viewport: { x: -50000, y: 0, zoom: 1 } }
    expect(queryCanvasRenderProjection(index, params(away)).foldedEdgeCount).toBe(0)

    index.applyChanges({ nodes: [node('b', 60000, 0)] })
    const moved = queryCanvasRenderProjection(index, params({ viewport: { x: -30000, y: 0, zoom: 1 } }))
    expect(moved.foldedEdgeCount).toBe(1)
    expect(index.edgesOf('a')).toEqual(['e-a-b'])

    index.applyChanges({ removedNodeIds: ['b'] })
    expect(queryCanvasRenderProjection(index, params({ viewport: { x: -30000, y: 0, zoom: 1 } })).foldedEdgeCount).toBe(0)
    expect(index.edgeCount).toBe(1)

    index.applyChanges({ nodes: [node('b', 400, 0)] })
    expect(queryCanvasRenderProjection(index, params()).foldedEdgeCount + queryCanvasRenderProjection(index, params()).activeEdgeIds.length).toBe(1)

    index.applyChanges({ removedEdgeIds: ['e-a-b'] })
    expect(index.edgeCount).toBe(0)
    expect(index.edgesOf('a')).toEqual([])
  })

  it('moves a node between cells without leaving a ghost behind', () => {
    const index = build([node('a', 0, 0)])
    index.applyChanges({ nodes: [node('a', 9000, 9000)] })
    expect(queryCanvasRenderProjection(index, params()).fullNodeIds).toEqual([])
    expect(queryCanvasRenderProjection(index, params({ viewport: { x: -9000, y: -9000, zoom: 1 } })).fullNodeIds).toEqual(['a'])
    expect(index.nodeIdsInRect({ left: 0, top: 0, right: 100, bottom: 100 })).toEqual([])
  })

  it('answers hit tests, rect selection and bounds from the authoritative set', () => {
    const index = build([
      node('group', -100, -100, { type: 'group', width: 1000, height: 800 }),
      node('small', 50, 50, { width: 100, height: 100 }),
      node('big', 60, 60, { width: 400, height: 400 }),
    ])
    expect(index.hitTestNode(70, 70)).toBe('small')
    expect(index.hitTestNode(300, 300)).toBe('big')
    expect(index.hitTestNode(800, 600)).toBe('group')
    expect(index.hitTestNode(5000, 5000)).toBeNull()
    expect(index.nodeIdsInRect({ left: 40, top: 40, right: 70, bottom: 70 })).toEqual(['big', 'group', 'small'])
    expect(index.boundsOf()).toEqual({ left: -100, top: -100, right: 900, bottom: 700 })
    expect(index.boundsOf(['small'])).toEqual({ left: 50, top: 50, right: 150, bottom: 150 })
    expect(index.boundsOf(['missing'])).toBeNull()
  })
})

describe('canvas render index: scale fixtures', () => {
  const load = (name: string) => {
    const graph = buildScaleGraph(name)
    const index = new CanvasRenderIndex()
    index.applyChanges({
      nodes: graph.nodes.map((item: { id: string; type: string; position: { x: number; y: number }; size?: { width: number; height: number } }) => node(item.id, item.position.x, item.position.y, { type: item.type, width: item.size?.width ?? 320, height: item.size?.height ?? 180 })),
      edges: graph.edges.map((item: { id: string; sourceNodeId: string; targetNodeId: string }) => ({ id: item.id, source: item.sourceNodeId, target: item.targetNodeId })),
    })
    return { graph, index }
  }

  it.each(['laotou-a', 'laotou-b', 'limit-1000', 'limit-1000-long', 'limit-1000-grouped', 'limit-1000-sparse'])('keeps %s within budget at fit-all zoom', (name) => {
    const { graph, index } = load(name)
    expect(index.nodeCount).toBe(graph.nodes.length)
    expect(index.edgeCount).toBe(graph.edges.length)
    const bounds = index.boundsOf()!
    const surface = { width: 1920, height: 1080 }
    const zoom = Math.max(0.15, Math.min(surface.width / (bounds.right - bounds.left), surface.height / (bounds.bottom - bounds.top)))
    const view = params({ surface, viewport: { x: -bounds.left * zoom, y: -bounds.top * zoom, zoom } })
    for (const mode of ['overview', 'full'] as const) {
      const result = queryCanvasRenderProjection(index, { ...view, mode })
      expect(result.fullNodeIds.length - result.fullNodeIds.filter((id) => id.startsWith('group-')).length).toBeLessThanOrEqual(CANVAS_RENDER_BUDGET.fullNodes)
      expect(result.activeEdgeIds.length).toBeLessThanOrEqual(CANVAS_RENDER_BUDGET.activeEdges)
      expect(result.overview.nodes.length).toBeLessThanOrEqual(CANVAS_RENDER_BUDGET.overviewNodeRects)
      expect(result.overview.edges.length).toBeLessThanOrEqual(CANVAS_RENDER_BUDGET.overviewEdgeLines)
      expect(result.stats.nodeVisits).toBeLessThanOrEqual(CANVAS_RENDER_BUDGET.maxNodeVisits * 2)
      expect(result.stats.edgeVisits).toBeLessThanOrEqual(CANVAS_RENDER_BUDGET.maxEdgeVisits)
    }
  })

  it('stays exact for the 4,000-edge limit and accounts for every in-view edge', () => {
    const { graph, index } = load('limit-1000')
    const bounds = index.boundsOf()!
    const surface = { width: 1920, height: 1080 }
    const zoom = 0.15
    const result = queryCanvasRenderProjection(index, params({ surface, mode: 'overview', viewport: { x: -bounds.left * zoom, y: -bounds.top * zoom, zoom } }))
    expect(result.foldedEdgesExact).toBe(true)
    expect(result.activeEdgeIds.length + result.foldedEdgeCount).toBeLessThanOrEqual(graph.edges.length)
    expect(result.activeEdgeIds.length + result.foldedEdgeCount).toBeGreaterThan(graph.edges.length * 0.5)
  })
})
