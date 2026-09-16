'use client'

import { useLayoutEffect, useRef, type ReactElement } from 'react'
import { createPortal } from 'react-dom'

type CanvasMenuPoint = { x: number; y: number }
type CanvasMenuRect = CanvasMenuPoint & { width: number; height: number }
type CanvasMenuViewport = CanvasMenuPoint & { width: number; height: number }

const CANVAS_MENU_VIEWPORT_MARGIN = 8

function clampedViewportCoordinate(value: number, start: number, extent: number, menuExtent: number) {
  const minimum = start + CANVAS_MENU_VIEWPORT_MARGIN
  const maximum = Math.max(minimum, start + extent - menuExtent - CANVAS_MENU_VIEWPORT_MARGIN)
  return Math.min(Math.max(value, minimum), maximum)
}

export function resolveCanvasMenuPortalPoint(
  anchor: CanvasMenuPoint,
  rendered: CanvasMenuRect,
  layoutSize: { width: number; height: number },
  viewport: CanvasMenuViewport,
): CanvasMenuPoint {
  const targetX = clampedViewportCoordinate(anchor.x, viewport.x, viewport.width, rendered.width)
  const targetY = clampedViewportCoordinate(anchor.y, viewport.y, viewport.height, rendered.height)
  const scaleX = layoutSize.width > 0 && rendered.width > 0 ? rendered.width / layoutSize.width : 1
  const scaleY = layoutSize.height > 0 && rendered.height > 0 ? rendered.height / layoutSize.height : 1

  // The menu is portalled outside .fos-app, but this correction also protects
  // against a browser/body zoom or transformed embedding shell. Both the
  // pointer and getBoundingClientRect use viewport coordinates, so reconciling
  // their delta keeps the menu under the cursor at every interface scale.
  return {
    x: anchor.x + (targetX - rendered.x) / scaleX,
    y: anchor.y + (targetY - rendered.y) / scaleY,
  }
}

export function CanvasMenuPortal({ children, point }: { children: ReactElement; point: CanvasMenuPoint }) {
  const portalRef = useRef<HTMLDivElement>(null)
  const { x, y } = point

  useLayoutEffect(() => {
    const menu = portalRef.current?.firstElementChild
    if (!(menu instanceof HTMLElement)) return
    const rect = menu.getBoundingClientRect()
    const visualViewport = window.visualViewport
    const resolved = resolveCanvasMenuPortalPoint(
      { x, y },
      { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
      { width: menu.offsetWidth, height: menu.offsetHeight },
      {
        x: visualViewport?.offsetLeft || 0,
        y: visualViewport?.offsetTop || 0,
        width: visualViewport?.width || window.innerWidth,
        height: visualViewport?.height || window.innerHeight,
      },
    )
    menu.style.left = `${resolved.x}px`
    menu.style.top = `${resolved.y}px`
  }, [x, y])

  if (typeof document === 'undefined') return children
  return createPortal(<div ref={portalRef} className="nori-canvas-menu-portal">{children}</div>, document.body)
}
