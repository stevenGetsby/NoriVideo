'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef } from 'react'
import { isProjectionStillNeeded, type CanvasRenderMode } from './canvas-render-budget'
import { planMountRamp } from './canvas-mount-ramp'
import { CanvasOverviewStore, type CanvasFoldedEdges } from './canvas-overview-store'
import {
  CanvasProjectionEngine,
  type EngineEdge,
  type EngineNode,
  type EngineSize,
  type EngineSurface,
  type EngineViewport,
} from './canvas-projection-engine'
import type { CanvasRenderProjection } from './canvas-viewport-index'

type FlowStoreState = {
  transform: readonly [number, number, number]
  width: number
  height: number
  panZoom?: unknown
}

type FlowStoreLike = {
  getState(): FlowStoreState
  subscribe(listener: (state: FlowStoreState) => void): () => void
}

export type ProjectionView = {
  mode: CanvasRenderMode
  fullIds: ReadonlySet<string>
  edgeIds: ReadonlySet<string>
}

export type ProjectedEdgeSummary = {
  id: string
  source: string
  target: string
  sourceTitle: string
  targetTitle: string
  role: string
}

const EMPTY_VIEW: ProjectionView = { mode: 'full', fullIds: new Set(), edgeIds: new Set() }

const NO_PINNED: readonly string[] = []

function toView(projection: CanvasRenderProjection): ProjectionView {
  return {
    mode: projection.mode,
    fullIds: new Set(projection.fullNodeIds),
    edgeIds: new Set(projection.activeEdgeIds),
  }
}

const foldedOf = (projection: CanvasRenderProjection): CanvasFoldedEdges => ({
  count: projection.foldedEdgeCount,
  ids: projection.foldedEdgeIds,
  exact: projection.foldedEdgesExact,
})

function sameIds(a: ReadonlySet<string>, b: ReadonlySet<string>) {
  if (a.size !== b.size) return false
  for (const id of a) if (!b.has(id)) return false
  return true
}

function sameView(a: ProjectionView, b: ProjectionView) {
  return a.mode === b.mode && sameIds(a.fullIds, b.fullIds) && sameIds(a.edgeIds, b.edgeIds)
}

export type UseCanvasRenderProjectionOptions<N extends EngineNode, E extends EngineEdge> = {
  enabled: boolean
  nodes: readonly N[]
  edges: readonly E[]
  flowStore: FlowStoreLike
  pinnedIds?: readonly string[]
  initialViewport: EngineViewport
  fallbackSurface: () => EngineSurface
  fallbackSize?: EngineSize
}

export type CanvasRenderProjectionResult<N extends EngineNode, E extends EngineEdge> = {
  active: boolean
  mode: CanvasRenderMode
  renderNodes: readonly N[]
  renderEdges: readonly E[]
  mountedNodeIds: ReadonlySet<string>
  overviewStore: CanvasOverviewStore
  getEngine: () => CanvasProjectionEngine | null
  describeFoldedEdges: () => ProjectedEdgeSummary[]
  requery: () => void
  setViewportZooming: (zooming: boolean) => void
}

/**
 * Splits React Flow's input from the authoritative graph. `nodes`/`edges` stay the business
 * source; only the projected subset is mounted. Small graphs pass straight through.
 */
export function useCanvasRenderProjection<N extends EngineNode, E extends EngineEdge>(
  options: UseCanvasRenderProjectionOptions<N, E>,
): CanvasRenderProjectionResult<N, E> {
  const { enabled, nodes, edges, flowStore, initialViewport, fallbackSurface, fallbackSize } = options
  const pinnedIds = options.pinnedIds ?? NO_PINNED
  const pinnedKey = pinnedIds.join(' ')
  const engineRef = useRef<CanvasProjectionEngine | null>(null)
  const activeRef = useRef(false)
  const viewRef = useRef<ProjectionView>(EMPTY_VIEW)
  const targetRef = useRef<ProjectionView>(EMPTY_VIEW)
  const rampFrameRef = useRef(0)
  const viewportZoomingRef = useRef(false)
  const applyTargetRef = useRef<() => void>(() => {})
  const pendingRef = useRef<CanvasRenderProjection | null>(null)
  const pinnedRef = useRef(pinnedIds)
  const initialViewportRef = useRef(initialViewport)
  const fallbackSurfaceRef = useRef(fallbackSurface)
  const fallbackSizeRef = useRef(fallbackSize)
  const overviewStoreRef = useRef<CanvasOverviewStore | null>(null)
  if (!overviewStoreRef.current) overviewStoreRef.current = new CanvasOverviewStore()
  const overviewStore = overviewStoreRef.current
  const [, bump] = useReducer((value: number) => value + 1, 0)
  pinnedRef.current = pinnedIds
  fallbackSurfaceRef.current = fallbackSurface
  fallbackSizeRef.current = fallbackSize

  const active = enabled && isProjectionStillNeeded(nodes.length, edges.length, activeRef.current)

  const readViewport = useCallback((): EngineViewport => {
    const state = flowStore.getState()
    if (state.panZoom && state.width > 0) return { x: state.transform[0], y: state.transform[1], zoom: state.transform[2] }
    return initialViewportRef.current
  }, [flowStore])

  const readSurface = useCallback((): EngineSurface => {
    const state = flowStore.getState()
    if (state.width > 0 && state.height > 0) return { width: state.width, height: state.height }
    return fallbackSurfaceRef.current()
  }, [flowStore])

  // The first projected frame is built during render so a large canvas never paints all nodes or an empty graph.
  if (active && !engineRef.current) {
    const engine = new CanvasProjectionEngine(fallbackSizeRef.current)
    engine.sync(nodes, edges, pinnedIds)
    const projection = engine.query(readViewport(), readSurface(), pinnedIds)
    engineRef.current = engine
    viewRef.current = toView(projection)
    targetRef.current = viewRef.current
    pendingRef.current = projection
  }

  const applyTarget = useCallback(() => {
    if (rampFrameRef.current) {
      window.cancelAnimationFrame(rampFrameRef.current)
      rampFrameRef.current = 0
    }
    const engine = engineRef.current
    if (!engine) return
    const target = targetRef.current
    const viewport = readViewport()
    const surface = readSurface()
    const centerX = (surface.width / 2 - viewport.x) / viewport.zoom
    const centerY = (surface.height / 2 - viewport.y) / viewport.zoom
    const plan = planMountRamp({
      mounted: viewRef.current.fullIds,
      target: target.fullIds,
      immediate: new Set([...engine.selectedNodeIds, ...engine.draggingNodeIds, ...pinnedRef.current]),
      distanceOf: (id) => {
        const node = engine.nodeSlot(id)
        return node ? (node.position.x - centerX) ** 2 + (node.position.y - centerY) ** 2 : Number.POSITIVE_INFINITY
      },
    })
    const next = plan.complete ? target : { mode: target.mode, fullIds: plan.admitted, edgeIds: target.edgeIds }
    if (!sameView(viewRef.current, next)) {
      viewRef.current = next
      bump()
    }
    if (!plan.complete) {
      rampFrameRef.current = window.requestAnimationFrame(() => {
        rampFrameRef.current = 0
        applyTargetRef.current()
      })
    }
  }, [readSurface, readViewport])
  applyTargetRef.current = applyTarget

  const recompute = useCallback(() => {
    const engine = engineRef.current
    if (!engine) return
    const projection = engine.query(readViewport(), readSurface(), pinnedRef.current, viewportZoomingRef.current ? 'zooming' : 'idle')
    overviewStore.set(projection.mode, projection.overview, foldedOf(projection))
    targetRef.current = toView(projection)
    applyTarget()
  }, [applyTarget, overviewStore, readSurface, readViewport])

  useEffect(() => () => {
    if (rampFrameRef.current) window.cancelAnimationFrame(rampFrameRef.current)
  }, [])

  useLayoutEffect(() => {
    activeRef.current = active
    if (!active) {
      if (engineRef.current) {
        engineRef.current = null
        viewRef.current = EMPTY_VIEW
        targetRef.current = EMPTY_VIEW
        overviewStore.clear()
      }
      return
    }
    const engine = engineRef.current
    if (!engine) return
    if (pendingRef.current) {
      overviewStore.set(pendingRef.current.mode, pendingRef.current.overview, foldedOf(pendingRef.current))
      pendingRef.current = null
    }
    const dirty = engine.sync(nodes, edges, pinnedRef.current)
    if (dirty || engine.needsQuery(readViewport(), readSurface(), viewportZoomingRef.current ? 'zooming' : 'idle')) recompute()
  }, [active, edges, nodes, overviewStore, pinnedKey, readSurface, readViewport, recompute])

  useEffect(() => {
    if (!active) return
    let frame = 0
    let lastTransform: FlowStoreState['transform'] | null = null
    let lastWidth = -1
    let lastHeight = -1
    const run = () => {
      frame = 0
      const engine = engineRef.current
      if (engine && engine.needsQuery(readViewport(), readSurface(), viewportZoomingRef.current ? 'zooming' : 'idle')) recompute()
    }
    const unsubscribe = flowStore.subscribe((state) => {
      if (state.transform === lastTransform && state.width === lastWidth && state.height === lastHeight) return
      lastTransform = state.transform
      lastWidth = state.width
      lastHeight = state.height
      if (!frame) frame = window.requestAnimationFrame(run)
    })
    run()
    return () => {
      unsubscribe()
      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [active, flowStore, readSurface, readViewport, recompute])

  const view = active ? viewRef.current : EMPTY_VIEW
  const renderNodes = useMemo(
    () => (active ? nodes.filter((node) => view.fullIds.has(node.id)) : nodes),
    [active, nodes, view.fullIds],
  )
  const renderEdges = useMemo(
    () => (active ? edges.filter((edge) => view.edgeIds.has(edge.id)) : edges),
    [active, edges, view.edgeIds],
  )

  const getEngine = useCallback(() => engineRef.current, [])
  const describeFoldedEdges = useCallback((): ProjectedEdgeSummary[] => {
    const engine = engineRef.current
    if (!engine) return []
    const result: ProjectedEdgeSummary[] = []
    for (const id of overviewStore.get()?.folded.ids ?? []) {
      const edge = engine.edgeSlot(id)
      if (!edge) continue
      result.push({
        id,
        source: edge.source,
        target: edge.target,
        sourceTitle: engine.titleOf(edge.source),
        targetTitle: engine.titleOf(edge.target),
        role: edge.data?.role ?? '',
      })
    }
    return result
  }, [overviewStore])
  const requery = useCallback(() => {
    engineRef.current?.markDirty()
    recompute()
  }, [recompute])
  const setViewportZooming = useCallback((zooming: boolean) => {
    if (viewportZoomingRef.current === zooming) return
    viewportZoomingRef.current = zooming
    engineRef.current?.markDirty()
    if (!zooming) recompute()
  }, [recompute])

  return {
    active,
    mode: view.mode,
    renderNodes,
    renderEdges,
    mountedNodeIds: view.fullIds,
    overviewStore,
    getEngine,
    describeFoldedEdges,
    requery,
    setViewportZooming,
  }
}
