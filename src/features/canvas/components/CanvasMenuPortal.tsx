'use client'

import type { ReactElement } from 'react'
import { createPortal } from 'react-dom'

export function CanvasMenuPortal({ children }: { children: ReactElement }) {
  if (typeof document === 'undefined') return children
  return createPortal(children, document.body)
}
