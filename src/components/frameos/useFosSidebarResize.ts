'use client'

import { useCallback, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import {
  FOS_SIDEBAR_WIDTH_DEFAULT,
  nextSidebarWidth,
  readInterfaceScale,
  readStoredSidebarWidth,
  writeStoredSidebarWidth,
} from '@/lib/frameos/sidebar-width'

export function useFosSidebarResize() {
  const [sidebarWidth, setSidebarWidth] = useState(readStoredSidebarWidth)
  const [sidebarResizing, setSidebarResizing] = useState(false)

  const beginSidebarResize = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()

    const handle = event.currentTarget
    const sidebar = handle.closest('.fos-sidebar')
    const startX = event.clientX
    const startWidth = sidebarWidth
    const scale = sidebar ? readInterfaceScale(sidebar) : 1
    setSidebarResizing(true)

    const finish = (clientX: number) => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      setSidebarResizing(false)
      const next = nextSidebarWidth(startWidth, startX, clientX, scale)
      setSidebarWidth(next)
      writeStoredSidebarWidth(next)
      try {
        handle.releasePointerCapture(event.pointerId)
      } catch {
        // Capture may already have been released by the browser.
      }
    }

    const onMove = (moveEvent: PointerEvent) => {
      setSidebarWidth(nextSidebarWidth(startWidth, startX, moveEvent.clientX, scale))
    }
    const onUp = (upEvent: PointerEvent) => finish(upEvent.clientX)

    try {
      handle.setPointerCapture(event.pointerId)
    } catch {
      // Pointer capture is optional; window listeners still complete the drag.
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }, [sidebarWidth])

  const resetSidebarWidth = useCallback(() => {
    setSidebarWidth(FOS_SIDEBAR_WIDTH_DEFAULT)
    writeStoredSidebarWidth(FOS_SIDEBAR_WIDTH_DEFAULT)
  }, [])

  return { sidebarWidth, sidebarResizing, beginSidebarResize, resetSidebarWidth }
}
