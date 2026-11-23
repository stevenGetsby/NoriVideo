import { CANVAS_RENDER_BUDGET, type CanvasGesture, type CanvasRenderMode } from './canvas-render-budget'

export type RenderNodeInput = { id: string; type: string; x: number; y: number; width: number; height: number }
export type RenderEdgeInput = { id: string; source: string; target: string; protected?: boolean }
export type CanvasRect = { left: number; top: number; right: number; bottom: number }
export type OverviewKind = 'image' | 'video' | 'audio' | 'text' | 'group' | 'other'

export type CanvasRenderChanges = {
  nodes?: readonly RenderNodeInput[]
  edges?: readonly RenderEdgeInput[]
  removedNodeIds?: Iterable<string>
  removedEdgeIds?: Iterable<string>
}

type IdCollection = ReadonlySet<string> | readonly string[] | undefined

export type CanvasProjectionParams = {
  viewport: { x: number; y: number; zoom: number }
  surface: { width: number; height: number }
  selectedNodeIds?: IdCollection
  selectedEdgeIds?: IdCollection
  pinnedNodeIds?: IdCollection
  gesture?: CanvasGesture
  mode: CanvasRenderMode
  bufferPx?: number
}

export type OverviewNodeRect = { id: string; x: number; y: number; width: number; height: number; kind: OverviewKind; selected: boolean }
export type OverviewCell = { x: number; y: number; width: number; height: number; count: number; kind: OverviewKind; selected: boolean }
export type OverviewSegment = { sx: number; sy: number; tx: number; ty: number; kind: OverviewKind }

export type CanvasRenderProjection = {
  mode: CanvasRenderMode
  rect: CanvasRect
  fullNodeIds: string[]
  activeEdgeIds: string[]
  overview: { nodes: OverviewNodeRect[]; cells: OverviewCell[]; edges: OverviewSegment[] }
  foldedEdgeCount: number
  foldedEdgeIds: string[]
  foldedEdgesExact: boolean
  stats: { nodeVisits: number; edgeVisits: number; cellVisits: number }
}

const KINDS: OverviewKind[] = ['image', 'video', 'audio', 'text', 'group', 'other']
const KIND_INDEX = new Map<string, number>([
  ['image', 0], ['model_3d', 0], ['studio_3d', 0], ['production_panel', 0],
  ['video', 1], ['video_edit', 1], ['video_superresolve', 1], ['playlist', 1], ['production_video', 1],
  ['audio', 2],
  ['text', 3], ['note', 3],
  ['group', 4],
])

export function overviewKindOf(type: string): OverviewKind {
  return KINDS[KIND_INDEX.get(type) ?? 5]
}

const FINE_CELL = 256
const EDGE_CELL = 1024
const AGG_SIZES = [256, 512, 1024, 2048, 4096, 8192, 16384, 32768, 65536]
const LARGE_NODE_CELLS = 36
const LONG_EDGE_CELLS = 64
const EDGE_PAD = 24
const CELL_OFFSET = 1 << 20
const CELL_STRIDE = 1 << 21
const COORD_LIMIT = 1e9

type NodeEntry = {
  id: string
  type: string
  kind: number
  x: number
  y: number
  w: number
  h: number
  cx: number
  cy: number
  cells: number[] | null
  aggKeys: number[]
}

type EdgeEntry = {
  id: string
  source: string
  target: string
  protected: boolean
  box: CanvasRect | null
  cells: number[] | null
  long: boolean
}

const finite = (value: number, fallback = 0) => (Number.isFinite(value) ? Math.max(-COORD_LIMIT, Math.min(COORD_LIMIT, value)) : fallback)
const cellKey = (cx: number, cy: number) => (cx + CELL_OFFSET) * CELL_STRIDE + (cy + CELL_OFFSET)
const cellOf = (value: number, size: number) => Math.floor(value / size)
const toSet = (ids: IdCollection): ReadonlySet<string> => (ids instanceof Set ? ids : new Set(ids ?? []))
const intersects = (a: CanvasRect, b: CanvasRect) => a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top
const nodeRect = (entry: NodeEntry): CanvasRect => ({ left: entry.x, top: entry.y, right: entry.x + entry.w, bottom: entry.y + entry.h })

function addToCell(map: Map<number, Set<string>>, key: number, id: string) {
  let set = map.get(key)
  if (!set) { set = new Set(); map.set(key, set) }
  set.add(id)
}

function removeFromCell(map: Map<number, Set<string>>, key: number, id: string) {
  const set = map.get(key)
  if (!set) return
  set.delete(id)
  if (set.size === 0) map.delete(key)
}

// Same curve family React Flow draws: horizontal handles, so the convex hull of the four control points bounds the path.
function edgeBox(source: NodeEntry, target: NodeEntry): CanvasRect {
  const sx = source.x + source.w
  const sy = source.y + source.h / 2
  const tx = target.x
  const ty = target.y + target.h / 2
  const dx = tx - sx
  const offset = dx >= 0 ? 0.5 * dx : 6.25 * Math.sqrt(-dx)
  const xs = [sx, tx, sx + offset, tx - offset]
  return {
    left: Math.min(...xs) - EDGE_PAD,
    right: Math.max(...xs) + EDGE_PAD,
    top: Math.min(sy, ty) - EDGE_PAD,
    bottom: Math.max(sy, ty) + EDGE_PAD,
  }
}

function cellKeysCovering(rect: CanvasRect, size: number, maxCells: number): number[] | null {
  const cx0 = cellOf(rect.left, size)
  const cx1 = cellOf(rect.right, size)
  const cy0 = cellOf(rect.top, size)
  const cy1 = cellOf(rect.bottom, size)
  if ((cx1 - cx0 + 1) * (cy1 - cy0 + 1) > maxCells) return null
  const keys: number[] = []
  for (let cx = cx0; cx <= cx1; cx += 1) for (let cy = cy0; cy <= cy1; cy += 1) keys.push(cellKey(cx, cy))
  return keys
}

export class CanvasRenderIndex {
  private readonly nodes = new Map<string, NodeEntry>()
  private readonly edges = new Map<string, EdgeEntry>()
  private readonly grid = new Map<number, Set<string>>()
  private readonly large = new Set<string>()
  private readonly agg: Array<Map<number, number[]>> = AGG_SIZES.map(() => new Map())
  private readonly edgeGrid = new Map<number, Set<string>>()
  private readonly longEdges = new Set<string>()
  private readonly adjacency = new Map<string, Set<string>>()

  get nodeCount() { return this.nodes.size }
  get edgeCount() { return this.edges.size }
  hasNode(id: string) { return this.nodes.has(id) }
  hasEdge(id: string) { return this.edges.has(id) }

  applyChanges(changes: CanvasRenderChanges) {
    for (const id of changes.removedEdgeIds ?? []) this.dropEdge(id)
    for (const id of changes.removedNodeIds ?? []) this.dropNode(id)
    for (const node of changes.nodes ?? []) this.upsertNode(node)
    for (const edge of changes.edges ?? []) this.upsertEdge(edge)
  }

  edgesOf(nodeId: string): string[] {
    return [...(this.adjacency.get(nodeId) ?? [])]
  }

  edgeEnds(edgeId: string): { source: string; target: string } | null {
    const edge = this.edges.get(edgeId)
    return edge ? { source: edge.source, target: edge.target } : null
  }

  nodeBox(id: string): { x: number; y: number; width: number; height: number; type: string } | null {
    const entry = this.nodes.get(id)
    return entry ? { x: entry.x, y: entry.y, width: entry.w, height: entry.h, type: entry.type } : null
  }

  boundsOf(ids?: Iterable<string>): CanvasRect | null {
    let left = Infinity
    let top = Infinity
    let right = -Infinity
    let bottom = -Infinity
    const visit = (entry: NodeEntry | undefined) => {
      if (!entry) return
      left = Math.min(left, entry.x)
      top = Math.min(top, entry.y)
      right = Math.max(right, entry.x + entry.w)
      bottom = Math.max(bottom, entry.y + entry.h)
    }
    if (ids) for (const id of ids) visit(this.nodes.get(id))
    else for (const entry of this.nodes.values()) visit(entry)
    return Number.isFinite(left) ? { left, top, right, bottom } : null
  }

  forEachNode(visit: (id: string, x: number, y: number, width: number, height: number, type: string) => void) {
    for (const entry of this.nodes.values()) visit(entry.id, entry.x, entry.y, entry.w, entry.h, entry.type)
  }

  // Selection and hit-testing act on the authoritative graph, so they are not capped.
  nodeIdsInRect(rect: CanvasRect): string[] {
    const ids = new Set<string>()
    const keys = cellKeysCovering(rect, FINE_CELL, Number.MAX_SAFE_INTEGER) ?? []
    for (const key of keys) {
      for (const id of this.grid.get(key) ?? []) {
        const entry = this.nodes.get(id)
        if (entry && intersects(nodeRect(entry), rect)) ids.add(id)
      }
    }
    for (const id of this.large) {
      const entry = this.nodes.get(id)
      if (entry && intersects(nodeRect(entry), rect)) ids.add(id)
    }
    return [...ids].sort()
  }

  hitTestNode(x: number, y: number): string | null {
    const point = { left: x, top: y, right: x, bottom: y }
    let best: NodeEntry | null = null
    const consider = (id: string) => {
      const entry = this.nodes.get(id)
      if (!entry || !intersects(nodeRect(entry), point)) return
      const better = !best
        || (best.kind === 4 && entry.kind !== 4)
        || (entry.kind !== 4 === (best.kind !== 4) && entry.w * entry.h < best.w * best.h)
      if (better) best = entry
    }
    for (const id of this.grid.get(cellKey(cellOf(x, FINE_CELL), cellOf(y, FINE_CELL))) ?? []) consider(id)
    for (const id of this.large) consider(id)
    return (best as NodeEntry | null)?.id ?? null
  }

  private upsertNode(input: RenderNodeInput) {
    const x = finite(input.x)
    const y = finite(input.y)
    const w = Math.max(0, finite(input.width))
    const h = Math.max(0, finite(input.height))
    const existing = this.nodes.get(input.id)
    if (existing && existing.type === input.type && existing.x === x && existing.y === y && existing.w === w && existing.h === h) return
    if (existing) this.unregisterNode(existing)
    const entry: NodeEntry = {
      id: input.id,
      type: input.type,
      kind: KIND_INDEX.get(input.type) ?? 5,
      x, y, w, h,
      cx: x + w / 2,
      cy: y + h / 2,
      cells: null,
      aggKeys: [],
    }
    this.nodes.set(entry.id, entry)
    this.registerNode(entry)
    for (const edgeId of this.adjacency.get(entry.id) ?? []) {
      const edge = this.edges.get(edgeId)
      if (edge) this.registerEdgeBox(edge)
    }
  }

  private registerNode(entry: NodeEntry) {
    const cells = cellKeysCovering(nodeRect(entry), FINE_CELL, LARGE_NODE_CELLS)
    entry.cells = cells
    if (cells) for (const key of cells) addToCell(this.grid, key, entry.id)
    else this.large.add(entry.id)
    entry.aggKeys = AGG_SIZES.map((size, level) => {
      const key = cellKey(cellOf(entry.cx, size), cellOf(entry.cy, size))
      const map = this.agg[level]
      let counts = map.get(key)
      if (!counts) { counts = [0, 0, 0, 0, 0, 0, 0]; map.set(key, counts) }
      counts[0] += 1
      counts[1 + entry.kind] += 1
      return key
    })
  }

  private unregisterNode(entry: NodeEntry) {
    if (entry.cells) for (const key of entry.cells) removeFromCell(this.grid, key, entry.id)
    else this.large.delete(entry.id)
    entry.aggKeys.forEach((key, level) => {
      const map = this.agg[level]
      const counts = map.get(key)
      if (!counts) return
      counts[0] -= 1
      counts[1 + entry.kind] -= 1
      if (counts[0] <= 0) map.delete(key)
    })
  }

  private dropNode(id: string) {
    const entry = this.nodes.get(id)
    if (!entry) return
    this.unregisterNode(entry)
    this.nodes.delete(id)
    for (const edgeId of this.adjacency.get(id) ?? []) {
      const edge = this.edges.get(edgeId)
      if (edge) this.registerEdgeBox(edge)
    }
  }

  private upsertEdge(input: RenderEdgeInput) {
    const existing = this.edges.get(input.id)
    if (existing && existing.source === input.source && existing.target === input.target && existing.protected === (input.protected === true)) return
    if (existing) this.dropEdge(input.id)
    const entry: EdgeEntry = {
      id: input.id,
      source: input.source,
      target: input.target,
      protected: input.protected === true,
      box: null,
      cells: null,
      long: false,
    }
    this.edges.set(entry.id, entry)
    for (const nodeId of [entry.source, entry.target]) {
      let set = this.adjacency.get(nodeId)
      if (!set) { set = new Set(); this.adjacency.set(nodeId, set) }
      set.add(entry.id)
    }
    this.registerEdgeBox(entry)
  }

  private dropEdge(id: string) {
    const entry = this.edges.get(id)
    if (!entry) return
    this.unregisterEdgeBox(entry)
    this.edges.delete(id)
    for (const nodeId of [entry.source, entry.target]) {
      const set = this.adjacency.get(nodeId)
      if (!set) continue
      set.delete(id)
      if (set.size === 0) this.adjacency.delete(nodeId)
    }
  }

  private unregisterEdgeBox(entry: EdgeEntry) {
    if (entry.cells) for (const key of entry.cells) removeFromCell(this.edgeGrid, key, entry.id)
    if (entry.long) this.longEdges.delete(entry.id)
    entry.cells = null
    entry.long = false
    entry.box = null
  }

  private registerEdgeBox(entry: EdgeEntry) {
    this.unregisterEdgeBox(entry)
    const source = this.nodes.get(entry.source)
    const target = this.nodes.get(entry.target)
    if (!source || !target) return
    entry.box = edgeBox(source, target)
    const cells = cellKeysCovering(entry.box, EDGE_CELL, LONG_EDGE_CELLS)
    if (cells) {
      entry.cells = cells
      for (const key of cells) addToCell(this.edgeGrid, key, entry.id)
    } else {
      entry.long = true
      this.longEdges.add(entry.id)
    }
  }

  /** @internal used by queryCanvasRenderProjection */
  internals() {
    return {
      nodes: this.nodes,
      edges: this.edges,
      grid: this.grid,
      large: this.large,
      agg: this.agg,
      edgeGrid: this.edgeGrid,
      longEdges: this.longEdges,
    }
  }
}

function viewRect(viewport: CanvasProjectionParams['viewport'], surface: CanvasProjectionParams['surface']): CanvasRect {
  const zoom = Math.max(viewport.zoom, 0.01)
  const left = -viewport.x / zoom
  const top = -viewport.y / zoom
  return { left, top, right: left + surface.width / zoom, bottom: top + surface.height / zoom }
}

function expandRect(rect: CanvasRect, by: number): CanvasRect {
  return { left: rect.left - by, top: rect.top - by, right: rect.right + by, bottom: rect.bottom + by }
}

function pickAggLevel(rect: CanvasRect): number {
  const target = Math.max(
    (rect.right - rect.left) / CANVAS_RENDER_BUDGET.overviewColumns,
    (rect.bottom - rect.top) / CANVAS_RENDER_BUDGET.overviewRows,
  )
  const level = AGG_SIZES.findIndex((size) => size >= target)
  return level === -1 ? AGG_SIZES.length - 1 : level
}

export function queryCanvasRenderProjection(index: CanvasRenderIndex, params: CanvasProjectionParams): CanvasRenderProjection {
  const budget = CANVAS_RENDER_BUDGET
  const { nodes, edges, grid, large, agg, edgeGrid, longEdges } = index.internals()
  const zoom = Math.max(params.viewport.zoom, 0.01)
  const view = viewRect(params.viewport, params.surface)
  const rect = expandRect(view, (params.bufferPx ?? budget.viewportBufferPx) / zoom)
  const centerX = (view.left + view.right) / 2
  const centerY = (view.top + view.bottom) / 2
  const distance = (x: number, y: number) => (x - centerX) ** 2 + (y - centerY) ** 2
  const pinned = toSet(params.pinnedNodeIds)
  const selected = toSet(params.selectedNodeIds)
  const selectedEdges = toSet(params.selectedEdgeIds)
  const stats = { nodeVisits: 0, edgeVisits: 0, cellVisits: 0 }

  const edgeCandidates: Array<{ entry: EdgeEntry; dist: number }> = []
  const seenEdges = new Set<string>()
  let edgesExact = true
  const visitEdge = (id: string) => {
    if (seenEdges.has(id)) return true
    if (stats.edgeVisits >= budget.maxEdgeVisits) { edgesExact = false; return false }
    stats.edgeVisits += 1
    seenEdges.add(id)
    const entry = edges.get(id)
    if (!entry?.box || !intersects(entry.box, rect)) return true
    edgeCandidates.push({ entry, dist: distance((entry.box.left + entry.box.right) / 2, (entry.box.top + entry.box.bottom) / 2) })
    return true
  }
  const edgeKeys = cellKeysCovering(rect, EDGE_CELL, Number.MAX_SAFE_INTEGER) ?? []
  stats.cellVisits += edgeKeys.length
  scan: {
    for (const id of longEdges) if (!visitEdge(id)) break scan
    for (const key of edgeKeys) for (const id of edgeGrid.get(key) ?? []) if (!visitEdge(id)) break scan
  }
  for (const id of selectedEdges) {
    if (seenEdges.has(id)) continue
    const box = edges.get(id)?.box
    if (box && intersects(box, rect)) visitEdge(id)
  }

  const mandatory: string[] = []
  const mandatorySet = new Set<string>()
  const addMandatory = (id: string) => {
    if (nodes.has(id) && !mandatorySet.has(id)) { mandatorySet.add(id); mandatory.push(id) }
  }
  for (const id of pinned) addMandatory(id)
  if (selected.size <= budget.selectedFullLimit) for (const id of selected) addMandatory(id)
  // A protected or selected edge can only be drawn by React Flow when both of its ends are mounted.
  let promotedSelected = 0
  for (const { entry } of edgeCandidates) {
    if (entry.protected) { addMandatory(entry.source); addMandatory(entry.target) }
    else if (selectedEdges.has(entry.id) && promotedSelected < 16) { promotedSelected += 1; addMandatory(entry.source); addMandatory(entry.target) }
  }
  const protectedEnds = new Set<string>()
  for (const { entry } of edgeCandidates) if (entry.protected) { protectedEnds.add(entry.source); protectedEnds.add(entry.target) }
  const ranked = mandatory
    .map((id) => ({ id, entry: nodes.get(id)!, locked: pinned.has(id) || protectedEnds.has(id) }))
    .sort((a, b) => Number(b.locked) - Number(a.locked) || distance(a.entry.cx, a.entry.cy) - distance(b.entry.cx, b.entry.cy) || (a.id < b.id ? -1 : 1))
  const fullSet = new Set<string>()
  for (const item of ranked) {
    if (fullSet.size >= budget.fullNodes && !protectedEnds.has(item.id)) break
    fullSet.add(item.id)
  }

  if (params.mode === 'full') {
    const considered = new Set<string>(fullSet)
    const groups: string[] = []
    const candidates: NodeEntry[] = []
    const need = Math.max(0, budget.fullNodes - fullSet.size)
    const visitNode = (id: string) => {
      if (considered.has(id)) return true
      if (stats.nodeVisits >= budget.maxNodeVisits) return false
      stats.nodeVisits += 1
      considered.add(id)
      const entry = nodes.get(id)
      if (!entry || !intersects(nodeRect(entry), rect)) return true
      if (entry.kind === 4) groups.push(id)
      else candidates.push(entry)
      return true
    }
    for (const id of large) visitNode(id)
    const cells: Array<{ key: number; dist: number }> = []
    const cx0 = cellOf(rect.left, FINE_CELL)
    const cx1 = cellOf(rect.right, FINE_CELL)
    const cy0 = cellOf(rect.top, FINE_CELL)
    const cy1 = cellOf(rect.bottom, FINE_CELL)
    for (let cx = cx0; cx <= cx1; cx += 1) {
      for (let cy = cy0; cy <= cy1; cy += 1) {
        const key = cellKey(cx, cy)
        if (grid.has(key)) cells.push({ key, dist: distance((cx + 0.5) * FINE_CELL, (cy + 0.5) * FINE_CELL) })
      }
    }
    stats.cellVisits += (cx1 - cx0 + 1) * (cy1 - cy0 + 1)
    cells.sort((a, b) => a.dist - b.dist || a.key - b.key)
    collect: for (const cell of need > 0 ? cells : []) {
      for (const id of grid.get(cell.key) ?? []) {
        if (!visitNode(id)) break collect
        if (candidates.length >= need * 2) break collect
      }
    }
    candidates.sort((a, b) => distance(a.cx, a.cy) - distance(b.cx, b.cy) || (a.id < b.id ? -1 : 1))
    for (const entry of candidates.slice(0, need)) fullSet.add(entry.id)
    groups.sort()
    for (const id of groups.slice(0, budget.maxFullGroups)) fullSet.add(id)
  }

  const edgeBudget = params.gesture && params.gesture !== 'idle' ? budget.activeEdgesInGesture : budget.activeEdges
  const tierOf = (entry: EdgeEntry) => (entry.protected ? 0
    : selectedEdges.has(entry.id) ? 1
      : pinned.has(entry.source) || pinned.has(entry.target) || selected.has(entry.source) || selected.has(entry.target) ? 2
        : 3)
  const drawable = edgeCandidates
    .filter(({ entry }) => fullSet.has(entry.source) && fullSet.has(entry.target))
    .map((item) => ({ ...item, tier: tierOf(item.entry) }))
    .sort((a, b) => a.tier - b.tier || a.dist - b.dist || (a.entry.id < b.entry.id ? -1 : 1))
  const active = new Set<string>()
  for (const item of drawable) {
    if (item.tier === 0 || active.size < edgeBudget) active.add(item.entry.id)
  }
  const folded = edgeCandidates
    .filter(({ entry }) => !active.has(entry.id))
    .sort((a, b) => a.dist - b.dist || (a.entry.id < b.entry.id ? -1 : 1))
  const segments: OverviewSegment[] = []
  for (const { entry } of folded) {
    if (segments.length >= budget.overviewEdgeLines) break
    const source = nodes.get(entry.source)
    const target = nodes.get(entry.target)
    if (!source || !target) continue
    segments.push({ sx: source.x + source.w, sy: source.y + source.h / 2, tx: target.x, ty: target.y + target.h / 2, kind: KINDS[source.kind] })
  }

  const level = pickAggLevel(rect)
  const size = AGG_SIZES[level]
  const aggMap = agg[level]
  const aggKeys: number[] = []
  const ax0 = cellOf(rect.left, size)
  const ax1 = cellOf(rect.right, size)
  const ay0 = cellOf(rect.top, size)
  const ay1 = cellOf(rect.bottom, size)
  let approxVisible = 0
  for (let cx = ax0; cx <= ax1; cx += 1) {
    for (let cy = ay0; cy <= ay1; cy += 1) {
      const key = cellKey(cx, cy)
      const counts = aggMap.get(key)
      if (counts) { approxVisible += counts[0]; aggKeys.push(key) }
    }
  }
  stats.cellVisits += (ax1 - ax0 + 1) * (ay1 - ay0 + 1)

  const overview: CanvasRenderProjection['overview'] = { nodes: [], cells: [], edges: segments }
  const individually = approxVisible - fullSet.size <= budget.overviewNodeRects
  if (individually) {
    const seen = new Set<string>(fullSet)
    let visits = 0
    let overflow = false
    const consider = (id: string) => {
      if (seen.has(id)) return true
      if (visits >= budget.maxNodeVisits * 2) { overflow = true; return false }
      visits += 1
      seen.add(id)
      const entry = nodes.get(id)
      if (!entry || !intersects(nodeRect(entry), rect)) return true
      overview.nodes.push({ id, x: entry.x, y: entry.y, width: entry.w, height: entry.h, kind: KINDS[entry.kind], selected: selected.has(id) })
      return true
    }
    individual: {
      for (const id of large) if (!consider(id)) break individual
      const fx0 = cellOf(rect.left, FINE_CELL)
      const fx1 = cellOf(rect.right, FINE_CELL)
      const fy0 = cellOf(rect.top, FINE_CELL)
      const fy1 = cellOf(rect.bottom, FINE_CELL)
      for (let cx = fx0; cx <= fx1; cx += 1) {
        for (let cy = fy0; cy <= fy1; cy += 1) {
          for (const id of grid.get(cellKey(cx, cy)) ?? []) if (!consider(id)) break individual
        }
      }
    }
    if (overflow) { overview.nodes = []; fillCells() } else overview.nodes.sort((a, b) => (a.id < b.id ? -1 : 1))
  } else {
    fillCells()
  }

  function fillCells() {
    const adjust = new Map<number, number[]>()
    for (const id of fullSet) {
      const entry = nodes.get(id)
      if (!entry) continue
      const key = entry.aggKeys[level]
      const delta = adjust.get(key) ?? [0, 0, 0, 0, 0, 0, 0]
      delta[0] += 1
      delta[1 + entry.kind] += 1
      adjust.set(key, delta)
    }
    const selectedKeys = new Set<number>()
    for (const id of selected) {
      const entry = nodes.get(id)
      if (entry && !fullSet.has(id)) selectedKeys.add(entry.aggKeys[level])
    }
    for (const key of aggKeys) {
      const counts = aggMap.get(key)!
      const delta = adjust.get(key)
      const count = counts[0] - (delta?.[0] ?? 0)
      if (count <= 0) continue
      let kind = 0
      let best = -1
      for (let i = 0; i < KINDS.length; i += 1) {
        const value = counts[1 + i] - (delta?.[1 + i] ?? 0)
        if (value > best) { best = value; kind = i }
      }
      const cx = Math.floor(key / CELL_STRIDE) - CELL_OFFSET
      const cy = (key % CELL_STRIDE) - CELL_OFFSET
      overview.cells.push({ x: cx * size, y: cy * size, width: size, height: size, count, kind: KINDS[kind], selected: selectedKeys.has(key) })
    }
    overview.cells.sort((a, b) => a.x - b.x || a.y - b.y)
  }

  const fullNodeIds = [...fullSet].sort()
  return {
    mode: params.mode,
    rect,
    fullNodeIds,
    activeEdgeIds: [...active].sort(),
    overview,
    foldedEdgeCount: folded.length,
    foldedEdgeIds: folded.map(({ entry }) => entry.id),
    foldedEdgesExact: edgesExact,
    stats,
  }
}
