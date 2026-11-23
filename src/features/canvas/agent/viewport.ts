import { getViewportForBounds } from '@xyflow/react'
import type { CanvasFlowNode } from '../editor-types'
import type { Viewport } from '../types'
import { canvasAgentBounds } from './commands/group'
import { isAgentNodeVisible } from './digest'

type Bounds = ReturnType<typeof canvasAgentBounds>
type ViewportWriter = { setViewport(viewport: Viewport, options?: { duration?: number }): unknown }

function surface(wrapper: HTMLElement) {
  const panel = wrapper.querySelector<HTMLElement>('.nori-canvas-agent-panel:not([hidden])')
  return { width: panel ? Math.max(160, panel.offsetLeft - 12) : wrapper.clientWidth, height: wrapper.clientHeight }
}

export function fitCanvasAgentBounds(flow: ViewportWriter | null, wrapper: HTMLElement | null, bounds: Bounds) {
  if (!flow || !wrapper) return
  const { width, height } = surface(wrapper)
  if (!width || !height || !bounds.width || !bounds.height) return
  void flow.setViewport(getViewportForBounds(bounds, width, height, 0.15, 1, 0.24), { duration: 300 })
}

export function followCanvasAgentNodes(flow: ViewportWriter | null, wrapper: HTMLElement | null, viewport: Viewport, nodes: readonly CanvasFlowNode[], ids: string[]) {
  if (!wrapper) return
  const targets = new Set(ids)
  const touched = nodes.filter((node) => targets.has(node.id))
  const { width, height } = surface(wrapper)
  const rect = { x: -viewport.x / viewport.zoom, y: -viewport.y / viewport.zoom, width: width / viewport.zoom, height: height / viewport.zoom }
  if (touched.some((node) => !isAgentNodeVisible(node, rect))) fitCanvasAgentBounds(flow, wrapper, canvasAgentBounds(touched))
}
