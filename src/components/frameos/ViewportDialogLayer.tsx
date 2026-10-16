'use client'

import { createPortal } from 'react-dom'
import type { ReactNode } from 'react'

/** Keep dialogs outside the workspace's CSS zoom and clipping containers. */
export function ViewportDialogLayer({ children }: { children: ReactNode }) {
  const content = <div className="fos-viewport-theme">{children}</div>
  return typeof document === 'undefined' ? content : createPortal(content, document.body)
}
