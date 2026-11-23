import { describe, expect, it } from 'vitest'
import {
  CANVAS_RENDER_BUDGET,
  isProjectionStillNeeded,
  isProtectedEdgeRole,
  needsRequery,
} from '../../../src/features/canvas/rendering/canvas-render-budget'
import {
  CanvasProjectionEngine,
  type EngineEdge,
  type EngineNode,
} from '../../../src/features/canvas/rendering/canvas-projection-engine'
import { CanvasOverviewStore } from '../../../src/features/canvas/rendering/canvas-overview-store'

const SURFACE = { width: 1000, height: 600 }
const VIEW = { x: 0, y: 0, zoom: 1 }

const node = (id: string, x = 0, y = 0, extra: Partial<EngineNode> = {}): EngineNode => ({
  id, type: 'image', position: { x, y }, width: 320, height: 180, ...extra,
})
const edge = (source: string, target: string, extra: Partial<EngineEdge> = {}): EngineEdge => ({
  id: `e-${source}-${target}`, source, target, ...extra,
})

function grid(count: number, columns = 40): EngineNode[] {
  return Array.from({ length: count }, (_, i) => node(`n${i}`, (i % columns) * 400, Math.floor(i / columns) * 260))
}

describe('canvas render budget helpers', () => {
  it('requeries only after half the buffer, a zoom change above 10%, or a surface change', () => {
    const last = { x: 0, y: 0, zoom: 1, width: 1000, height: 600 }
    expect(needsRequery(null, last)).toBe(true)
    expect(needsRequery(last, { ...last, x: 100 })).toBe(false)
    expect(needsRequery(last, { ...last, x: -101 })).toBe(true)
    expect(needsRequery(last, { ...last, y: 101 })).toBe(true)
    expect(needsRequery(last, { ...last, zoom: 1.1 })).toBe(false)
    expect(needsRequery(last, { ...last, zoom: 1.11 })).toBe(true)
    expect(needsRequery(last, { ...last, zoom: 0.9 })).toBe(true)
    expect(needsRequery(last, { ...last, width: 1001 })).toBe(true)
    expect(needsRequery(last, { ...last, zoom: Number.NaN })).toBe(true)
  })

  it('enters projection above the threshold and leaves only well below it', () => {
    expect(isProjectionStillNeeded(80, 160, false)).toBe(false)
    expect(isProjectionStillNeeded(81, 0, false)).toBe(true)
    expect(isProjectionStillNeeded(70, 100, true)).toBe(true)
    expect(isProjectionStillNeeded(64, 128, true)).toBe(false)
    expect(isProjectionStillNeeded(10, 129, true)).toBe(true)
  })

  it('protects story, mount and picture edges from clipping', () => {
    for (const role of ['STORY_FLOW', 'STORY_BRANCH', 'MOUNT', 'MOUNT_AUDIO', 'PICTURE_REF']) {
      expect(isProtectedEdgeRole(role)).toBe(true)
    }
    for (const role of ['REF', 'INPUT_DEFAULT', 'FIRST_FRAME', undefined, '']) {
      expect(isProtectedEdgeRole(role)).toBe(false)
    }
  })
})

describe('canvas projection engine: sync', () => {
  it('does not mount rich cards while wheel zoom is crossing out of overview', () => {
    const engine = new CanvasProjectionEngine()
    engine.sync(grid(1000), [])
    const overview = { x: 0, y: 0, zoom: 0.3 }
    const aboveExit = { x: 0, y: 0, zoom: 0.45 }
    expect(engine.query(overview, SURFACE).mode).toBe('overview')
    const moving = engine.query(aboveExit, SURFACE, [], 'zooming')
    expect(moving.mode).toBe('overview')
    expect(moving.fullNodeIds).toHaveLength(0)
    expect(engine.needsQuery(aboveExit, SURFACE)).toBe(true)
    const settled = engine.query(aboveExit, SURFACE)
    expect(settled.mode).toBe('full')
    expect(settled.fullNodeIds.length).toBeGreaterThan(0)
  })

  it('is dirty on the first sync and clean after a query', () => {
    const engine = new CanvasProjectionEngine()
    const nodes = [node('a'), node('b', 400)]
    const edges = [edge('a', 'b')]
    expect(engine.sync(nodes, edges)).toBe(true)
    engine.query(VIEW, SURFACE)
    expect(engine.sync(nodes, edges)).toBe(false)
    expect(engine.needsQuery(VIEW, SURFACE)).toBe(false)
  })

  it('stays clean when a node object is replaced with identical geometry', () => {
    const engine = new CanvasProjectionEngine()
    const nodes = [node('a'), node('b', 400)]
    engine.sync(nodes, [])
    engine.query(VIEW, SURFACE)
    const replaced = [{ ...nodes[0], data: { title: 'renamed' } }, nodes[1]]
    expect(engine.sync(replaced, [])).toBe(false)
    expect(engine.titleOf('a')).toBe('renamed')
  })

  it('does not re-rank while a node merely follows the pointer', () => {
    const engine = new CanvasProjectionEngine()
    const base = [node('a'), node('b', 400)]
    engine.sync(base, [])
    engine.query(VIEW, SURFACE)
    const startDrag = [{ ...base[0], dragging: true }, base[1]]
    expect(engine.sync(startDrag, [])).toBe(true)
    engine.query(VIEW, SURFACE)
    const moved = [{ ...startDrag[0], position: { x: 30, y: 12 } }, base[1]]
    expect(engine.sync(moved, [])).toBe(false)
    expect(engine.index.nodeBox('a')).toMatchObject({ x: 30, y: 12 })
    const stopped = [{ ...moved[0], dragging: false }, base[1]]
    expect(engine.sync(stopped, [])).toBe(true)
  })

  it('becomes dirty on geometry change, selection change and pinned change', () => {
    const engine = new CanvasProjectionEngine()
    const base = [node('a'), node('b', 400)]
    engine.sync(base, [])
    engine.query(VIEW, SURFACE)

    expect(engine.sync([{ ...base[0], position: { x: 5, y: 0 } }, base[1]], [])).toBe(true)
    engine.query(VIEW, SURFACE)

    const resized = [{ ...base[0], position: { x: 5, y: 0 }, width: 500 }, base[1]]
    expect(engine.sync(resized, [])).toBe(true)
    engine.query(VIEW, SURFACE)

    const selected = [{ ...resized[0], selected: true }, base[1]]
    expect(engine.sync(selected, [])).toBe(true)
    expect([...engine.selectedNodeIds]).toEqual(['a'])
    engine.query(VIEW, SURFACE)

    expect(engine.sync(selected, [], ['b'])).toBe(true)
    engine.query(VIEW, SURFACE, ['b'])
    expect(engine.sync(selected, [], ['b'])).toBe(false)
  })

  it('detects removed nodes and edges and drops them from the index', () => {
    const engine = new CanvasProjectionEngine()
    const nodes = [node('a'), node('b', 400), node('c', 800)]
    const edges = [edge('a', 'b'), edge('b', 'c')]
    engine.sync(nodes, edges)
    engine.query(VIEW, SURFACE)

    expect(engine.sync([nodes[0], nodes[2]], [])).toBe(true)
    expect(engine.index.hasNode('b')).toBe(false)
    expect(engine.index.hasEdge('e-a-b')).toBe(false)
    expect(engine.nodeSlot('b')).toBeNull()
    expect(engine.edgeSlot('e-b-c')).toBeNull()
    expect(engine.nodeSlot('a')).toBe(nodes[0])
  })

  it('detects an edge that changes endpoints without changing id', () => {
    const engine = new CanvasProjectionEngine()
    const nodes = [node('a'), node('b', 400), node('c', 800)]
    const original = edge('a', 'b', { id: 'e1' })
    engine.sync(nodes, [original])
    engine.query(VIEW, SURFACE)
    expect(engine.sync(nodes, [{ ...original, target: 'c' }])).toBe(true)
    expect(engine.edgesOfNodes(['c'])).toEqual(['e1'])
    expect(engine.edgesOfNodes(['b'])).toEqual([])
  })

  it('marks protected roles so the index never folds them', () => {
    const engine = new CanvasProjectionEngine()
    const nodes = [node('a'), node('b', 400)]
    engine.sync(nodes, [edge('a', 'b', { data: { role: 'STORY_FLOW' } })])
    const projection = engine.query(VIEW, SURFACE)
    expect(projection.activeEdgeIds).toEqual(['e-a-b'])
    expect(projection.foldedEdgeCount).toBe(0)
  })

  it('falls back to declared then default size when measurement is missing', () => {
    const engine = new CanvasProjectionEngine((type) => (type === 'audio' ? { width: 111, height: 55 } : { width: 320, height: 240 }))
    engine.sync([
      node('measured', 0, 0, { measured: { width: 200, height: 100 }, width: 999, height: 999 }),
      node('declared', 0, 0, { width: 150, height: 90 }),
      node('fallback', 0, 0, { type: 'audio', width: null, height: undefined }),
    ], [])
    expect(engine.index.nodeBox('measured')).toMatchObject({ width: 200, height: 100 })
    expect(engine.index.nodeBox('declared')).toMatchObject({ width: 150, height: 90 })
    expect(engine.index.nodeBox('fallback')).toMatchObject({ width: 111, height: 55 })
  })
})

describe('canvas projection engine: query', () => {
  it('mounts only a bounded set for a large graph and keeps selection and pinned nodes', () => {
    const engine = new CanvasProjectionEngine()
    const nodes = grid(1000).map((n) => (n.id === 'n999' ? { ...n, selected: true } : n))
    engine.sync(nodes, [])
    const projection = engine.query(VIEW, SURFACE, ['n500'])
    expect(projection.fullNodeIds.length).toBeLessThanOrEqual(CANVAS_RENDER_BUDGET.fullNodes + CANVAS_RENDER_BUDGET.selectedFullLimit + 1)
    expect(projection.fullNodeIds).toContain('n999')
    expect(projection.fullNodeIds).toContain('n500')
    expect(projection.fullNodeIds).toContain('n0')
  })

  it('requeries on zoom threshold crossing with hysteresis', () => {
    const engine = new CanvasProjectionEngine()
    engine.sync(grid(200), [])
    expect(engine.query(VIEW, SURFACE).mode).toBe('full')
    expect(engine.renderMode).toBe('full')
    expect(engine.needsQuery({ ...VIEW, zoom: 0.31 }, SURFACE)).toBe(true) // >10% zoom change
    expect(engine.query({ ...VIEW, zoom: 0.29 }, SURFACE).mode).toBe('overview')
    expect(engine.query({ ...VIEW, zoom: 0.35 }, SURFACE).mode).toBe('overview')
    expect(engine.needsQuery({ ...VIEW, zoom: 0.38 }, SURFACE)).toBe(true)
    expect(engine.query({ ...VIEW, zoom: 0.38 }, SURFACE).mode).toBe('full')
  })

  it('does not requery for a small pan and requeries after crossing half the buffer', () => {
    const engine = new CanvasProjectionEngine()
    engine.sync(grid(200), [])
    engine.query(VIEW, SURFACE)
    expect(engine.needsQuery({ x: -80, y: 0, zoom: 1 }, SURFACE)).toBe(false)
    expect(engine.needsQuery({ x: -120, y: 0, zoom: 1 }, SURFACE)).toBe(true)
  })

  it('asks for a requery after markDirty', () => {
    const engine = new CanvasProjectionEngine()
    engine.sync(grid(10), [])
    engine.query(VIEW, SURFACE)
    expect(engine.needsQuery(VIEW, SURFACE)).toBe(false)
    engine.markDirty()
    expect(engine.needsQuery(VIEW, SURFACE)).toBe(true)
  })

  it('pins dragging nodes and uses the dragging edge budget', () => {
    const engine = new CanvasProjectionEngine()
    const nodes = grid(300).map((n) => (n.id === 'n250' ? { ...n, dragging: true } : n))
    engine.sync(nodes, [])
    const projection = engine.query(VIEW, SURFACE)
    expect(projection.fullNodeIds).toContain('n250')
    expect([...engine.draggingNodeIds]).toEqual(['n250'])
  })

  it('indexes ~1000 node moves per frame quickly enough for layout animation', () => {
    const engine = new CanvasProjectionEngine()
    let nodes = grid(1000)
    engine.sync(nodes, [])
    engine.query(VIEW, SURFACE)
    const frames: number[] = []
    for (let frame = 1; frame <= 5; frame += 1) {
      nodes = nodes.map((n) => ({ ...n, position: { x: n.position.x + frame, y: n.position.y + frame } }))
      const start = performance.now()
      engine.sync(nodes, [])
      engine.query(VIEW, SURFACE)
      frames.push(performance.now() - start)
    }
    frames.sort((a, b) => a - b)
    expect(frames[Math.floor(frames.length / 2)]).toBeLessThan(25)
  })
})

describe('canvas overview store', () => {
  it('notifies subscribers on set and on the first clear only', () => {
    const store = new CanvasOverviewStore()
    const calls: number[] = []
    const unsubscribe = store.subscribe(() => calls.push(store.get()?.version ?? -1))
    const overview = { nodes: [], cells: [], edges: [] }
    const folded = { count: 0, ids: [], exact: true }
    store.set('overview', overview, folded)
    store.set('overview', overview, folded)
    store.clear()
    store.clear()
    expect(calls).toEqual([1, 2, -1])
    unsubscribe()
    store.set('full', overview, folded)
    expect(calls).toHaveLength(3)
    expect(store.get()?.version).toBe(3)
  })
})

describe('projected box selection', () => {
  it('selects unmounted nodes from the index, skips groups, and honours the 14% overlap rule', async () => {
    const { projectedNodeIdsInLayoutRect } = await import('../../../src/features/canvas/rendering/projected-marquee')
    const engine = new CanvasProjectionEngine()
    const nodes = [
      ...grid(200),
      node('frame', -50, -50, { type: 'group', width: 4000, height: 2000 }),
    ]
    engine.sync(nodes, [])
    const view = { x: 20, y: 10, zoom: 0.5 }
    // layout (20,10)-(220,150) covers flow (0,0)-(400,280): n0 fully, n1 only its first 0px edge.
    const ids = projectedNodeIdsInLayoutRect(engine.index, { left: 20, top: 10, right: 20 + 180, bottom: 10 + 130 }, view)
    expect(ids).toContain('n0')
    expect(ids).not.toContain('frame')
    expect(ids).not.toContain('n40')
    // n0 box is 320x180 at zoom .5 => 160x90 layout px; a brush over a sliver of it selects nothing.
    expect(projectedNodeIdsInLayoutRect(engine.index, { left: 20, top: 10, right: 24, bottom: 14 }, view)).toEqual([])
  })

  it('rejects a degenerate zoom', async () => {
    const { projectedNodeIdsInLayoutRect } = await import('../../../src/features/canvas/rendering/projected-marquee')
    const engine = new CanvasProjectionEngine()
    engine.sync(grid(3), [])
    expect(projectedNodeIdsInLayoutRect(engine.index, { left: 0, top: 0, right: 100, bottom: 100 }, { x: 0, y: 0, zoom: 0 })).toEqual([])
  })
})
