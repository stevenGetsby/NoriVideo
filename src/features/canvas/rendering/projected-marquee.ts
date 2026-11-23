import { screenRectSelectsNode, type ScreenRect } from '../edge-marquee'
import type { CanvasRect } from './canvas-viewport-index'

type MarqueeIndex = {
  nodeIdsInRect(rect: CanvasRect): string[]
  nodeBox(id: string): { x: number; y: number; width: number; height: number; type: string } | null
}

/**
 * Box selection over the authoritative render index, so nodes projection has unmounted are still selected.
 * `layoutRect` is in the wrapper's layout pixels; groups are skipped like the DOM marquee does.
 */
export function projectedNodeIdsInLayoutRect(
  index: MarqueeIndex,
  layoutRect: ScreenRect,
  viewport: { x: number; y: number; zoom: number },
): string[] {
  const { x, y, zoom } = viewport
  if (!(zoom > 0)) return []
  const flowRect: CanvasRect = {
    left: (layoutRect.left - x) / zoom,
    top: (layoutRect.top - y) / zoom,
    right: (layoutRect.right - x) / zoom,
    bottom: (layoutRect.bottom - y) / zoom,
  }
  const ids: string[] = []
  for (const id of index.nodeIdsInRect(flowRect)) {
    const box = index.nodeBox(id)
    if (!box || box.type === 'group') continue
    if (screenRectSelectsNode(layoutRect, {
      left: x + box.x * zoom,
      top: y + box.y * zoom,
      right: x + (box.x + box.width) * zoom,
      bottom: y + (box.y + box.height) * zoom,
    })) ids.push(id)
  }
  return ids
}
