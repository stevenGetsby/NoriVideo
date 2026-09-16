'use client'

import type { PointerEvent as ReactPointerEvent } from 'react'

export function FosSidebarResizer({
  collapsed,
  resizing,
  onPointerDown,
  onDoubleClick,
}: {
  collapsed: boolean
  resizing: boolean
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onDoubleClick: () => void
}) {
  if (collapsed) return null
  return (
    <button
      type="button"
      className={`fos-sidebar-resizer${resizing ? ' is-active' : ''}`}
      aria-label="调整导航栏宽度"
      title="拖动调整宽度，双击恢复默认"
      data-testid="fos-sidebar-resizer"
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
    />
  )
}
