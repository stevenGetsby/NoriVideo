'use client'

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { CanvasOverviewStore } from './canvas-overview-store'
import type { ProjectedEdgeSummary } from './useCanvasRenderProjection'

const ROW_HEIGHT = 32
const LIST_HEIGHT = 288
const OVERSCAN = 6

export type CanvasFoldedEdgesEntryProps = {
  store: CanvasOverviewStore
  describe: () => ProjectedEdgeSummary[]
  onLocate: (edge: ProjectedEdgeSummary) => void
  onDisconnect?: (edge: ProjectedEdgeSummary) => void
  aboveMinimap: boolean
}

const label = (title: string, id: string) => title || `节点 ${id.slice(0, 6)}`

// Edges the render budget leaves undrawn stay reachable here; they still count for generation references.
export const CanvasFoldedEdgesEntry = memo(function CanvasFoldedEdgesEntry({ store, describe, onLocate, onDisconnect, aboveMinimap }: CanvasFoldedEdgesEntryProps) {
  const snapshot = useSyncExternalStore(store.subscribe, store.get, () => null)
  const count = snapshot?.folded.count ?? 0
  const exact = snapshot?.folded.exact ?? true
  const version = snapshot?.version ?? 0
  const [open, setOpen] = useState(false)
  const [scrollTop, setScrollTop] = useState(0)
  const [focusIndex, setFocusIndex] = useState<number | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  // `version` changes whenever the projection re-ranks, which is exactly when the folded set can change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const items = useMemo(() => (open ? describe() : []), [open, describe, version])

  const close = useCallback(() => {
    setOpen(false)
    setFocusIndex(null)
    setScrollTop(0)
  }, [])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && rootRef.current?.contains(event.target)) return
      close()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [close, open])

  useLayoutEffect(() => {
    if (focusIndex === null) return
    listRef.current?.querySelector<HTMLElement>(`[data-row="${focusIndex}"] .nori-canvas-folded-locate`)?.focus()
  }, [focusIndex, scrollTop])

  if (count <= 0 && !open) return null

  const total = items.length
  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
  const last = Math.min(total, Math.ceil((scrollTop + LIST_HEIGHT) / ROW_HEIGHT) + OVERSCAN)

  const moveFocus = (next: number) => {
    if (total === 0) return
    const index = Math.max(0, Math.min(total - 1, next))
    const list = listRef.current
    if (list) {
      const top = index * ROW_HEIGHT
      if (top < list.scrollTop) list.scrollTop = top
      else if (top + ROW_HEIGHT > list.scrollTop + LIST_HEIGHT) list.scrollTop = top + ROW_HEIGHT - LIST_HEIGHT
      setScrollTop(list.scrollTop)
    }
    setFocusIndex(index)
  }

  return (
    <div
      ref={rootRef}
      className={`nori-canvas-folded-edges${aboveMinimap ? ' is-above-minimap' : ''}`}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.stopPropagation()
          close()
          triggerRef.current?.focus()
        }
      }}
    >
      {open ? (
        <div className="nori-canvas-folded-panel" role="dialog" aria-label="未绘制的连接">
          <p>{exact ? `${count} 条连接为保持流畅未绘制，仍参与生成引用` : `至少 ${count} 条连接未绘制（仅列出距视口最近的部分），仍参与生成引用`}</p>
          <div
            ref={listRef}
            className="nori-canvas-folded-list"
            role="list"
            style={{ height: Math.min(LIST_HEIGHT, Math.max(ROW_HEIGHT, total * ROW_HEIGHT)) }}
            onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
            onKeyDown={(event) => {
              const row = event.target instanceof Element ? Number(event.target.closest<HTMLElement>('[data-row]')?.dataset.row ?? Number.NaN) : Number.NaN
              if (Number.isNaN(row)) return
              if (event.key === 'ArrowDown') { event.preventDefault(); moveFocus(row + 1) }
              else if (event.key === 'ArrowUp') { event.preventDefault(); moveFocus(row - 1) }
              else if (event.key === 'Home') { event.preventDefault(); moveFocus(0) }
              else if (event.key === 'End') { event.preventDefault(); moveFocus(total - 1) }
            }}
          >
            <div style={{ height: total * ROW_HEIGHT, position: 'relative' }}>
              {items.slice(first, last).map((edge, offset) => {
                const index = first + offset
                const source = label(edge.sourceTitle, edge.source)
                const target = label(edge.targetTitle, edge.target)
                const tabIndex = (focusIndex === null ? index === first : focusIndex === index) ? 0 : -1
                return (
                  <div
                    key={edge.id}
                    role="listitem"
                    data-row={index}
                    className="nori-canvas-folded-row"
                    style={{ position: 'absolute', top: index * ROW_HEIGHT, left: 0, right: 0, height: ROW_HEIGHT }}
                  >
                    <button
                      type="button"
                      className="nori-canvas-folded-locate"
                      tabIndex={tabIndex}
                      title={`${source} → ${target}`}
                      onClick={() => onLocate(edge)}
                    >
                      <span>{source}</span>
                      <i aria-hidden="true">→</i>
                      <span>{target}</span>
                      {edge.role ? <em>{edge.role}</em> : null}
                    </button>
                    {onDisconnect ? (
                      <button
                        type="button"
                        className="nori-canvas-folded-disconnect"
                        tabIndex={tabIndex}
                        aria-label={`断开 ${source} 到 ${target} 的连接`}
                        onClick={() => onDisconnect(edge)}
                      >
                        断开
                      </button>
                    ) : null}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      ) : null}
      <button
        ref={triggerRef}
        type="button"
        className="nori-canvas-folded-trigger"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
      >
        查看 {count} 条连接
      </button>
    </div>
  )
})
