'use client'

import { useCallback, useLayoutEffect, useRef, type HTMLAttributes, type RefObject } from 'react'
import { createPortal } from 'react-dom'

type Rect = { left: number; top: number; right: number; bottom: number; width: number }
type Viewport = { left: number; top: number; width: number; height: number }

export function resolveViewportPopover(
  anchor: Rect,
  viewport: Viewport,
  input: { width: number; height: number; maxHeight: number; preferredSide: 'above' | 'below' },
) {
  const margin = 12
  const gap = 8
  const width = Math.min(input.width, Math.max(1, viewport.width - margin * 2))
  const topLimit = viewport.top + margin
  const bottomLimit = viewport.top + viewport.height - margin
  const above = Math.max(0, anchor.top - gap - topLimit)
  const below = Math.max(0, bottomLimit - anchor.bottom - gap)
  const wantedHeight = Math.min(input.height, input.maxHeight, Math.max(1, bottomLimit - topLimit))
  const preferredSpace = input.preferredSide === 'above' ? above : below
  const side = preferredSpace >= wantedHeight
    ? input.preferredSide
    : above > below ? 'above' : 'below'
  // A very tall anchor may fill the viewport. Keep the popup operable even
  // then, rather than squeezing the list to an invisible few pixels.
  const maxHeight = Math.min(input.maxHeight, Math.max(1, bottomLimit - topLimit), Math.max(120, side === 'above' ? above : below))
  const height = Math.min(wantedHeight, maxHeight)
  return {
    left: Math.max(viewport.left + margin, Math.min(anchor.left, viewport.left + viewport.width - width - margin)),
    top: Math.max(topLimit, Math.min(side === 'above' ? anchor.top - gap - height : anchor.bottom + gap, bottomLimit - height)),
    width,
    maxHeight,
    side,
  }
}

/** Portals escape canvas transforms, CSS zoom and scroll-container clipping. */
export function ViewportPopover({
  anchorRef,
  onClose,
  preferredSide = 'below',
  width,
  maxHeight = 360,
  className = '',
  children,
  ...attributes
}: HTMLAttributes<HTMLDivElement> & {
  anchorRef: RefObject<HTMLElement | null>
  onClose: () => void
  preferredSide?: 'above' | 'below'
  width?: number
  maxHeight?: number
}) {
  const popoverRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  const reposition = useCallback(() => {
    const anchor = anchorRef.current
    const popup = popoverRef.current
    if (!anchor || !popup) return
    const viewport = window.visualViewport
    const bounds = {
      left: viewport?.offsetLeft || 0,
      top: viewport?.offsetTop || 0,
      width: viewport?.width || window.innerWidth,
      height: viewport?.height || window.innerHeight,
    }
    const rect = anchor.getBoundingClientRect()
    const ownerDialog = anchor.closest('[role="dialog"], .nori-canvas-studio-dialog, .nori-canvas-media-preview')
    const ownerLayer = ownerDialog ? Number.parseInt(getComputedStyle(ownerDialog).zIndex, 10) || 0 : 0
    popup.style.width = `${Math.min(width ?? rect.width, bounds.width - 24)}px`
    popup.style.maxHeight = `${Math.min(maxHeight, bounds.height - 24)}px`
    const resolved = resolveViewportPopover(rect, bounds, {
      width: width ?? rect.width,
      height: popup.scrollHeight + 2,
      maxHeight,
      preferredSide,
    })
    Object.assign(popup.style, {
      left: `${resolved.left}px`,
      top: `${resolved.top}px`,
      width: `${resolved.width}px`,
      maxHeight: `${resolved.maxHeight}px`,
      visibility: 'visible',
      zIndex: String(Math.max(2700, ownerLayer + 100)),
    })
    popup.dataset.placement = resolved.side
  }, [anchorRef, maxHeight, preferredSide, width])

  useLayoutEffect(() => { reposition() })
  useLayoutEffect(() => {
    let frame = 0
    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(reposition)
    }
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !popoverRef.current?.contains(event.target) && !anchorRef.current?.contains(event.target)) {
        onCloseRef.current()
      }
    }
    const observer = new ResizeObserver(schedule)
    if (anchorRef.current) observer.observe(anchorRef.current)
    if (popoverRef.current) observer.observe(popoverRef.current)
    window.addEventListener('resize', schedule)
    window.addEventListener('scroll', schedule, true)
    window.visualViewport?.addEventListener('resize', schedule)
    window.visualViewport?.addEventListener('scroll', schedule)
    document.addEventListener('pointerdown', outside, true)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('resize', schedule)
      window.removeEventListener('scroll', schedule, true)
      window.visualViewport?.removeEventListener('resize', schedule)
      window.visualViewport?.removeEventListener('scroll', schedule)
      document.removeEventListener('pointerdown', outside, true)
    }
  }, [anchorRef, reposition])

  if (typeof document === 'undefined') return null
  return createPortal(
    <div
      {...attributes}
      ref={popoverRef}
      className={`nori-viewport-popover nodrag nowheel ${className}`}
      style={{ position: 'fixed', visibility: 'hidden', zIndex: 2700, boxSizing: 'border-box', overflowY: 'auto', overscrollBehavior: 'contain' }}
      onPointerDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => { event.preventDefault(); event.stopPropagation() }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          onCloseRef.current()
          anchorRef.current?.focus()
        }
      }}
    >{children}</div>,
    document.body,
  )
}
