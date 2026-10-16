'use client'

import { createPortal } from 'react-dom'
import type { ReactNode } from 'react'

/** Modal geometry must not inherit canvas transforms or the shell's CSS zoom. */
export function CanvasViewportLayer({ children }: { children: ReactNode }) {
  if (typeof document === 'undefined') return <>{children}</>
  return createPortal(
    <div className="nori-canvas-viewport-layer" onPointerDown={(event) => event.stopPropagation()}>{children}</div>,
    document.body,
  )
}
