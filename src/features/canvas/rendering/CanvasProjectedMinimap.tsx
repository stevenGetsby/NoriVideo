'use client'

import { useEffect, useRef } from 'react'
import type { CanvasOverviewStore } from './canvas-overview-store'
import type { CanvasProjectionEngine } from './canvas-projection-engine'

type FlowStoreState = {
  transform: readonly [number, number, number]
  width: number
  height: number
}

type FlowStoreLike = {
  getState(): FlowStoreState
  subscribe(listener: (state: FlowStoreState) => void): () => void
}

export type CanvasProjectedMinimapProps = {
  getEngine: () => CanvasProjectionEngine | null
  store: CanvasOverviewStore
  flowStore: FlowStoreLike
  nodeStroke: string
  selectedStroke: string
  maskColor: string
  maskStroke: string
  ariaLabel: string
  onZoom?: (factor: number) => void
}

const MINIMAP_WIDTH = 190
const MINIMAP_HEIGHT = 120
const OFFSET_SCALE = 8
const WHEEL_ZOOM_STEP = 8
const GROUP_COLOR = 'rgba(121, 139, 184, .34)'
const VIDEO_COLOR = '#c25591'
const AUDIO_COLOR = '#d99a38'
const IMAGE_COLOR = '#4b84db'
const MODEL_COLOR = '#45a77e'
const OTHER_COLOR = '#8a76d8'

const VIDEO_TYPES = new Set(['video', 'video_edit', 'video_superresolve', 'playlist', 'production_video'])
const MODEL_TYPES = new Set(['model_3d', 'studio_3d'])

export function minimapColorForType(type: string): string {
  if (type === 'group') return GROUP_COLOR
  if (VIDEO_TYPES.has(type)) return VIDEO_COLOR
  if (type === 'audio') return AUDIO_COLOR
  if (type === 'image' || type === 'production_panel') return IMAGE_COLOR
  if (MODEL_TYPES.has(type)) return MODEL_COLOR
  return OTHER_COLOR
}

const rectPath = (x: number, y: number, width: number, height: number) => `M${x} ${y}h${width}v${height}h${-width}z`

type Bounds = { x: number; y: number; width: number; height: number }

export function minimapViewBox(nodeBounds: Bounds | null, view: Bounds): Bounds {
  let bounding = view
  if (nodeBounds) {
    const left = Math.min(nodeBounds.x, view.x)
    const top = Math.min(nodeBounds.y, view.y)
    const right = Math.max(nodeBounds.x + nodeBounds.width, view.x + view.width)
    const bottom = Math.max(nodeBounds.y + nodeBounds.height, view.y + view.height)
    bounding = { x: left, y: top, width: right - left, height: bottom - top }
  }
  const viewScale = Math.max(bounding.width / MINIMAP_WIDTH, bounding.height / MINIMAP_HEIGHT) || 1
  const viewWidth = viewScale * MINIMAP_WIDTH
  const viewHeight = viewScale * MINIMAP_HEIGHT
  const offset = OFFSET_SCALE * viewScale
  return {
    x: bounding.x - (viewWidth - bounding.width) / 2 - offset,
    y: bounding.y - (viewHeight - bounding.height) / 2 - offset,
    width: viewWidth + offset * 2,
    height: viewHeight + offset * 2,
  }
}

// Mirrors React Flow's MiniMap contract (class names, flow-space viewBox, evenodd mask) but reads the
// full render index, so nodes that projection has unmounted still appear. Pan frames only touch the mask.
export function CanvasProjectedMinimap({
  getEngine,
  store,
  flowStore,
  nodeStroke,
  selectedStroke,
  maskColor,
  maskStroke,
  ariaLabel,
  onZoom,
}: CanvasProjectedMinimapProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const maskRef = useRef<SVGPathElement>(null)
  const nodesRef = useRef<SVGGElement>(null)
  const engineGetterRef = useRef(getEngine)
  const zoomRef = useRef(onZoom)

  useEffect(() => {
    engineGetterRef.current = getEngine
    zoomRef.current = onZoom
  }, [getEngine, onZoom])

  useEffect(() => {
    const svg = svgRef.current
    const mask = maskRef.current
    const group = nodesRef.current
    if (!svg || !mask || !group) return
    let frame = 0
    let lastMinimapVersion = -1
    let lastTransform: FlowStoreState['transform'] | null = null
    let cachedEngine: CanvasProjectionEngine | null = null
    let cachedBounds: Bounds | null = null

    const rebuildNodes = (engine: CanvasProjectionEngine) => {
      const buckets = new Map<string, string>()
      const selected = engine.selectedNodeIds
      let selectedPath = ''
      let left = Infinity
      let top = Infinity
      let right = -Infinity
      let bottom = -Infinity
      engine.index.forEachNode((id, x, y, width, height, type) => {
        left = Math.min(left, x)
        top = Math.min(top, y)
        right = Math.max(right, x + width)
        bottom = Math.max(bottom, y + height)
        const path = rectPath(x, y, width, height)
        if (selected.has(id)) selectedPath += path
        else {
          const color = minimapColorForType(type)
          buckets.set(color, (buckets.get(color) ?? '') + path)
        }
      })
      cachedBounds = Number.isFinite(left) ? { x: left, y: top, width: right - left, height: bottom - top } : null
      group.replaceChildren()
      for (const [color, d] of buckets) {
        const element = document.createElementNS('http://www.w3.org/2000/svg', 'path')
        element.setAttribute('d', d)
        element.style.fill = color
        element.style.stroke = nodeStroke
        element.style.strokeWidth = '3'
        group.appendChild(element)
      }
      if (selectedPath) {
        const element = document.createElementNS('http://www.w3.org/2000/svg', 'path')
        element.setAttribute('d', selectedPath)
        element.style.fill = minimapColorForType('image')
        element.style.stroke = selectedStroke
        element.style.strokeWidth = '3'
        group.appendChild(element)
      }
    }

    const paint = () => {
      frame = 0
      const engine = engineGetterRef.current()
      if (!engine) {
        group.replaceChildren()
        mask.setAttribute('d', '')
        cachedEngine = null
        lastMinimapVersion = -1
        return
      }
      if (engine !== cachedEngine || engine.minimapNodeVersion !== lastMinimapVersion) {
        cachedEngine = engine
        lastMinimapVersion = engine.minimapNodeVersion
        rebuildNodes(engine)
      }
      const state = flowStore.getState()
      lastTransform = state.transform
      const [tx, ty, zoom] = state.transform
      if (!zoom || !state.width || !state.height) return
      const view = { x: -tx / zoom, y: -ty / zoom, width: state.width / zoom, height: state.height / zoom }
      const box = minimapViewBox(cachedBounds, view)
      svg.setAttribute('viewBox', `${box.x} ${box.y} ${box.width} ${box.height}`)
      const outer = rectPath(box.x - box.width, box.y - box.height, box.width * 3, box.height * 3)
      mask.setAttribute('d', `${outer}${rectPath(view.x, view.y, view.width, view.height)}`)
    }

    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(paint)
    }
    const unsubscribeStore = store.subscribe(schedule)
    const unsubscribeFlow = flowStore.subscribe((state) => {
      if (state.transform !== lastTransform) schedule()
    })
    const onWheel = (event: WheelEvent) => {
      if (!zoomRef.current) return
      event.preventDefault()
      const unit = event.deltaMode === 1 ? 0.05 : event.deltaMode ? 1 : 0.002
      zoomRef.current(2 ** (-event.deltaY * unit * WHEEL_ZOOM_STEP))
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    paint()
    return () => {
      unsubscribeStore()
      unsubscribeFlow()
      svg.removeEventListener('wheel', onWheel)
      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [flowStore, nodeStroke, selectedStroke, store])

  return (
    <div className="react-flow__panel react-flow__minimap nori-canvas-minimap bottom left" data-testid="rf__minimap">
      {/* eslint-disable-next-line no-restricted-syntax -- This SVG is a minimap chart, not an interface icon. */}
      <svg
        ref={svgRef}
        className="react-flow__minimap-svg"
        width={MINIMAP_WIDTH}
        height={MINIMAP_HEIGHT}
        viewBox={`0 0 ${MINIMAP_WIDTH} ${MINIMAP_HEIGHT}`}
        role="img"
        aria-label={ariaLabel}
      >
        <title>{ariaLabel}</title>
        <g ref={nodesRef} />
        <path
          ref={maskRef}
          className="react-flow__minimap-mask"
          fillRule="evenodd"
          style={{ fill: maskColor, stroke: maskStroke, strokeWidth: 2 }}
        />
      </svg>
    </div>
  )
}
