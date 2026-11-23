'use client'

import { useEffect, useRef } from 'react'
import type { CanvasOverviewSnapshot, CanvasOverviewStore } from './canvas-overview-store'
import type { OverviewKind } from './canvas-viewport-index'

export const OVERVIEW_KIND_COLORS: Record<OverviewKind, string> = {
  image: '#4b84db',
  video: '#c25591',
  audio: '#d99a38',
  text: '#8a76d8',
  group: 'rgba(121, 139, 184, .34)',
  other: '#8a76d8',
}

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

export type CanvasOverviewLayerProps = {
  store: CanvasOverviewStore
  flowStore: FlowStoreLike
  getTitle: (id: string) => string
  edgeColor: string
  selectedColor: string
  labelColor: string
}

const MAX_BACKING_PIXELS = 16_000_000

function bezierOffset(dx: number) {
  return dx >= 0 ? 0.5 * dx : 6.25 * Math.sqrt(-dx)
}

export function drawCanvasOverview(
  ctx: CanvasRenderingContext2D,
  snapshot: CanvasOverviewSnapshot,
  transform: readonly [number, number, number],
  scale: number,
  size: { width: number; height: number },
  colors: Pick<CanvasOverviewLayerProps, 'edgeColor' | 'selectedColor' | 'labelColor'>,
  getTitle: (id: string) => string,
) {
  const [tx, ty, zoom] = transform
  const px = 1 / zoom
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, size.width * scale, size.height * scale)
  ctx.setTransform(zoom * scale, 0, 0, zoom * scale, tx * scale, ty * scale)

  const { overview } = snapshot
  if (overview.edges.length) {
    ctx.save()
    ctx.globalAlpha = 0.5
    ctx.strokeStyle = colors.edgeColor
    ctx.lineWidth = px
    ctx.beginPath()
    for (const edge of overview.edges) {
      const offset = bezierOffset(edge.tx - edge.sx)
      ctx.moveTo(edge.sx, edge.sy)
      ctx.bezierCurveTo(edge.sx + offset, edge.sy, edge.tx - offset, edge.ty, edge.tx, edge.ty)
    }
    ctx.stroke()
    ctx.restore()
  }

  for (const cell of overview.cells) {
    const density = Math.min(1, Math.log2(cell.count + 1) / 7)
    ctx.globalAlpha = 0.22 + 0.55 * density
    ctx.fillStyle = OVERVIEW_KIND_COLORS[cell.kind] === OVERVIEW_KIND_COLORS.group ? '#798bb8' : OVERVIEW_KIND_COLORS[cell.kind]
    ctx.fillRect(cell.x + px, cell.y + px, cell.width - 2 * px, cell.height - 2 * px)
    ctx.globalAlpha = 1
    if (cell.selected) {
      ctx.strokeStyle = colors.selectedColor
      ctx.lineWidth = 2 * px
      ctx.strokeRect(cell.x + px, cell.y + px, cell.width - 2 * px, cell.height - 2 * px)
    }
    if (cell.width * zoom >= 36) {
      ctx.fillStyle = colors.labelColor
      ctx.font = `600 ${13 * px}px system-ui, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(String(cell.count), cell.x + cell.width / 2, cell.y + cell.height / 2)
    }
  }

  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  for (const node of overview.nodes) {
    ctx.globalAlpha = node.kind === 'group' ? 1 : 0.88
    ctx.fillStyle = OVERVIEW_KIND_COLORS[node.kind]
    ctx.fillRect(node.x, node.y, node.width, node.height)
    ctx.globalAlpha = 1
    if (node.selected) {
      ctx.strokeStyle = colors.selectedColor
      ctx.lineWidth = 2 * px
      ctx.strokeRect(node.x, node.y, node.width, node.height)
    }
    if (node.width * zoom >= 84 && node.height * zoom >= 26 && node.kind !== 'group') {
      const title = getTitle(node.id)
      if (title) {
        ctx.fillStyle = '#ffffff'
        ctx.font = `500 ${12 * px}px system-ui, sans-serif`
        ctx.fillText(title, node.x + 8 * px, node.y + 18 * px, node.width - 16 * px)
      }
    }
  }
  ctx.globalAlpha = 1
}

export function CanvasOverviewLayer({ store, flowStore, getTitle, edgeColor, selectedColor, labelColor }: CanvasOverviewLayerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const colorsRef = useRef({ edgeColor, selectedColor, labelColor })
  const titleRef = useRef(getTitle)
  const redrawRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    titleRef.current = getTitle
  }, [getTitle])

  useEffect(() => {
    colorsRef.current = { edgeColor, selectedColor, labelColor }
    redrawRef.current?.()
  }, [edgeColor, selectedColor, labelColor])

  useEffect(() => {
    const canvas = canvasRef.current
    const parent = canvas?.parentElement
    if (!canvas || !parent) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    let frame = 0
    let scale = 1
    let cssWidth = 0
    let cssHeight = 0
    let lastTransform: FlowStoreState['transform'] | null = null

    const resize = () => {
      const width = parent.clientWidth
      const height = parent.clientHeight
      if (!width || !height) return
      const visual = parent.getBoundingClientRect().width
      const zoomFactor = visual > 0 && width > 0 ? visual / width : 1
      let nextScale = Math.max(1, (window.devicePixelRatio || 1) * zoomFactor)
      while (width * height * nextScale * nextScale > MAX_BACKING_PIXELS && nextScale > 1) nextScale = Math.max(1, nextScale - 0.25)
      if (width === cssWidth && height === cssHeight && nextScale === scale) return
      cssWidth = width
      cssHeight = height
      scale = nextScale
      canvas.width = Math.round(width * scale)
      canvas.height = Math.round(height * scale)
      schedule()
    }

    const draw = () => {
      frame = 0
      const snapshot = store.get()
      const state = flowStore.getState()
      lastTransform = state.transform
      if (!cssWidth || !cssHeight) return
      if (!snapshot || !state.panZoom) {
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        return
      }
      drawCanvasOverview(ctx, snapshot, state.transform, scale, { width: cssWidth, height: cssHeight }, colorsRef.current, titleRef.current)
    }

    function schedule() {
      if (!frame) frame = window.requestAnimationFrame(draw)
    }

    redrawRef.current = schedule
    const unsubscribeStore = store.subscribe(schedule)
    const unsubscribeFlow = flowStore.subscribe((state) => {
      if (state.transform !== lastTransform) schedule()
    })
    const observer = new ResizeObserver(resize)
    observer.observe(parent)
    resize()
    schedule()
    return () => {
      redrawRef.current = null
      unsubscribeStore()
      unsubscribeFlow()
      observer.disconnect()
      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [flowStore, store])

  return <canvas ref={canvasRef} className="nori-canvas-overview" aria-hidden="true" data-canvas-overview />
}
