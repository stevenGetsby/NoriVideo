'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { UIEvent } from 'react'
import { useParams, usePathname } from 'next/navigation'
import type { FrameosMaterialItem } from '@/components/frameos/materials/contracts'
import {
  fetchFrameosMaterialPage,
  MATERIAL_PAGE_SIZE,
  useWindowedList,
} from '@/components/frameos/materials/material-page-client'
import { AppIcon } from '@/components/ui/icons'
import { Check, Film, ImageIcon, LayoutGrid, Music2, X } from '@/components/ui/icons'
import { MediaImage } from '@/components/media/MediaImage'
import { filterByFuzzyQuery } from '@/lib/frameos/fuzzy-match'
import { toCanvasDisplayImageUrl, toPlayableVideoUrl, toVideoPosterUrl } from '@/lib/media/image-url'
import {
  CANVAS_REFERENCE_PICKER_TYPES,
  type CanvasReferencePickerItem,
  type CanvasReferencePickerType,
} from '../canvas-reference-picker'
import { CanvasViewportLayer } from './CanvasViewportLayer'

const TYPE_LABELS: Record<CanvasReferencePickerType, string> = { image: '图片', video: '视频', audio: '音频' }
const TYPE_ICONS = { image: ImageIcon, video: Film, audio: Music2 } as const
const PICKER_ROW_HEIGHT = 163
const PICKER_GRID_COLUMNS = 5
const PICKER_GRID_GAP = 12
const PICKER_LOAD_MORE_DISTANCE = PICKER_ROW_HEIGHT * 2

type CanvasPickerRoute = { projectId: string; canvasId: string }

/** Supports both the ordinary /canvas/[project]/[canvas] and story chapter routes. */
export function canvasReferencePickerRoute(pathname: string | null, params: Record<string, string | string[] | undefined> | null): CanvasPickerRoute | null {
  const storyProjectId = typeof params?.projectId === 'string' ? params.projectId : ''
  const storyCanvas = params?.canvas
  if (storyProjectId) return { projectId: storyProjectId, canvasId: Array.isArray(storyCanvas) ? storyCanvas[0] || '' : storyCanvas || '' }
  const segments = (pathname || '').split('/').filter(Boolean)
  const canvasIndex = segments.indexOf('canvas')
  return canvasIndex >= 0 && segments[canvasIndex + 1]
    ? { projectId: decodeURIComponent(segments[canvasIndex + 1]), canvasId: segments[canvasIndex + 2] ? decodeURIComponent(segments[canvasIndex + 2]) : '' }
    : null
}

function materialCanvasNodeId(material: FrameosMaterialItem): string {
  const nodeId = material.metadata?.canvasNodeId
  return typeof nodeId === 'string' ? nodeId.trim() : ''
}

function materialCanvasItem(material: FrameosMaterialItem, item: CanvasReferencePickerItem): CanvasReferencePickerItem {
  const preview = typeof material.metadata?.posterUrl === 'string' ? material.metadata.posterUrl
    : typeof material.metadata?.imageUrl === 'string' ? material.metadata.imageUrl
      : item.mediaType === 'image' ? material.url : null
  return {
    ...item,
    title: material.title?.trim() || item.title,
    preview: preview || item.preview,
    videoSrc: item.mediaType === 'video' ? material.url || item.videoSrc : item.videoSrc,
  }
}

function materialPageMatches(
  materials: readonly FrameosMaterialItem[],
  itemById: ReadonlyMap<string, CanvasReferencePickerItem>,
  typeFilter: 'all' | CanvasReferencePickerType,
): CanvasReferencePickerItem[] {
  const seen = new Set<string>()
  const matches: CanvasReferencePickerItem[] = []
  for (const material of materials) {
    const item = itemById.get(materialCanvasNodeId(material))
    if (!item || seen.has(item.id) || (typeFilter !== 'all' && item.mediaType !== typeFilter)) continue
    seen.add(item.id)
    matches.push(materialCanvasItem(material, item))
  }
  return matches
}

function isPickerRouteCurrent(route: CanvasPickerRoute, pathname: string | null, params: Record<string, string | string[] | undefined> | null) {
  const current = canvasReferencePickerRoute(pathname, params)
  return current?.projectId === route.projectId && current?.canvasId === route.canvasId
}

/** A wrapper is a grid row; its siblings contribute no additional row height. */
export function canvasReferencePickerRowCount(index: number): number {
  return index % PICKER_GRID_COLUMNS === 0 ? 1 : 0
}

function pickerRowCountAt(index: number): number {
  return canvasReferencePickerRowCount(index)
}

export function CanvasReferencePickerDialog({
  items,
  remaining,
  orderLabel = (position) => String(position + 1),
  onConfirm,
  onClose,
}: {
  items: readonly CanvasReferencePickerItem[]
  /** How many more references of each type the model still accepts. */
  remaining: Readonly<Record<CanvasReferencePickerType, number>>
  /** Badge text for the Nth pick (0-based). */
  orderLabel?: (position: number) => string
  /** Return an error message to keep the dialog open, or null once the caller handled and closed it. */
  onConfirm: (ids: string[]) => string | null
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [appliedQuery, setAppliedQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<'all' | CanvasReferencePickerType>('all')
  const [selected, setSelected] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [materials, setMaterials] = useState<FrameosMaterialItem[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [total, setTotal] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [resolvedQueryKey, setResolvedQueryKey] = useState('')
  const pathname = usePathname()
  const params = useParams()
  const route = useMemo(() => canvasReferencePickerRoute(pathname, params), [pathname, params])
  const queryKey = `${route?.projectId || ''}\n${route?.canvasId || ''}\n${typeFilter}\n${appliedQuery.trim()}`
  const requestIdRef = useRef(0)
  const requestAbortRef = useRef<AbortController | null>(null)
  const loadingRef = useRef(false)
  const loadingMoreRef = useRef(false)
  const nextCursorRef = useRef<string | null>(null)
  nextCursorRef.current = nextCursor
  const dialogRef = useRef<HTMLElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  // The canvas and the generator shortcuts live on window: Escape is handled here
  // whatever has focus, and keys aimed at the page behind the modal are swallowed.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (event.isComposing) return
        event.preventDefault()
        event.stopPropagation()
        onCloseRef.current()
        return
      }
      if (!(event.target instanceof Node && dialogRef.current?.contains(event.target))) event.stopPropagation()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])

  const itemById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items])
  const typesPresent = useMemo(
    () => CANVAS_REFERENCE_PICKER_TYPES.filter((type) => items.some((item) => item.mediaType === type)),
    [items],
  )
  const countByType = useMemo(() => {
    const counts: Record<CanvasReferencePickerType, number> = { image: 0, video: 0, audio: 0 }
    for (const item of items) counts[item.mediaType] += 1
    return counts
  }, [items])
  const selectedByType = (type: CanvasReferencePickerType) => selected.filter((id) => itemById.get(id)?.mediaType === type).length
  const capacityLeft = (type: CanvasReferencePickerType) => Math.max(0, (remaining[type] ?? 0) - selectedByType(type))

  const cancelMaterialReads = useCallback(() => {
    requestIdRef.current += 1
    requestAbortRef.current?.abort()
  }, [])

  const load = useCallback(async (cursor: string | null = null) => {
    const paging = Boolean(cursor)
    const requestId = paging ? requestIdRef.current : ++requestIdRef.current
    if (!paging) {
      requestAbortRef.current?.abort()
      setResolvedQueryKey('')
    }
    if (paging && (cursor !== nextCursorRef.current || loadingMoreRef.current || loadingRef.current)) return
    if (!route) {
      setMaterials([])
      setNextCursor(null)
      setTotal(null)
      setLoading(false)
      loadingRef.current = false
      return
    }
    const controller = new AbortController()
    requestAbortRef.current = controller
    if (paging) {
      setLoadingMore(true)
      loadingMoreRef.current = true
    } else {
      setLoading(true)
      loadingRef.current = true
    }
    setLoadError(null)
    try {
      const queryParams = new URLSearchParams({
        projectId: route.projectId,
        canvasId: route.canvasId,
        limit: String(MATERIAL_PAGE_SIZE),
        pageVersion: '1',
        deduplicate: '1',
      })
      if (typeFilter !== 'all') queryParams.set('type', typeFilter)
      if (appliedQuery.trim()) queryParams.set('query', appliedQuery.trim())
      if (cursor) queryParams.set('cursor', cursor)
      const page = await fetchFrameosMaterialPage(queryParams, controller.signal)
      if (requestId !== requestIdRef.current || controller.signal.aborted || !isPickerRouteCurrent(route, pathname, params)) return
      setMaterials((current) => {
        if (!paging) return page.materials
        const unique = new Map(current.map((item) => [item.id, item]))
        for (const item of page.materials) unique.set(item.id, item)
        return [...unique.values()]
      })
      setNextCursor(page.nextCursor)
      setTotal(page.total ?? (paging ? null : page.materials.length))
      if (!paging) setResolvedQueryKey(queryKey)
    } catch (loadFailure) {
      if (requestId !== requestIdRef.current || controller.signal.aborted) return
      if (!paging) {
        setMaterials([])
        setNextCursor(null)
        setTotal(null)
      }
      setLoadError(loadFailure instanceof Error ? loadFailure.message : '加载画布素材失败')
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false)
        setLoadingMore(false)
        loadingRef.current = false
        loadingMoreRef.current = false
      }
    }
  }, [appliedQuery, params, pathname, queryKey, route, typeFilter])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), appliedQuery.trim() ? 250 : 0)
    return () => {
      window.clearTimeout(timer)
      cancelMaterialReads()
    }
  }, [appliedQuery, cancelMaterialReads, load, loadAttempt])

  useEffect(() => () => cancelMaterialReads(), [cancelMaterialReads])

  const serverFiltered = Boolean(appliedQuery.trim() || typeFilter !== 'all')
  const matched = useMemo(() => materialPageMatches(materials, itemById, typeFilter), [itemById, materials, typeFilter])
  const visible = useMemo(() => {
    const typed = typeFilter === 'all' ? items : items.filter((item) => item.mediaType === typeFilter)
    const local = serverFiltered
      ? filterByFuzzyQuery(typed.map((item) => ({ item, label: item.title })), appliedQuery).map((entry) => entry.item)
      : [...typed]
    if (resolvedQueryKey !== queryKey || loading || loadError) return local
    // Nodes that have not been registered as materials remain valid canvas references.
    return matched.length > 0 || items.length === 0 ? matched : local
  }, [appliedQuery, items, loadError, loading, matched, queryKey, resolvedQueryKey, serverFiltered, typeFilter])
  const resolvedMaterials = resolvedQueryKey === queryKey && !loadError && matched.length > 0
  const resultTotal = resolvedMaterials && total !== null ? total : visible.length
  const windowedItems = useMemo(() => visible.map((item, index) => ({ item, rows: pickerRowCountAt(index) })), [visible])
  const { scrollerRef, onScroll, totalHeight, window: listWindow, offsets } = useWindowedList(
    windowedItems,
    PICKER_ROW_HEIGHT,
    (entry) => entry.rows,
  )
  const scrollGrid = (event: UIEvent<HTMLDivElement>) => {
    onScroll(event)
    const element = event.currentTarget
    if (element.scrollHeight - element.scrollTop - element.clientHeight < PICKER_LOAD_MORE_DISTANCE && nextCursor && !loading && !loadingMore) void load(nextCursor)
  }

  useEffect(() => {
    if (scrollerRef.current) scrollerRef.current.scrollTop = 0
  }, [appliedQuery, scrollerRef, typeFilter])

  useEffect(() => {
    if (loading || loadingMore || !nextCursor || visible.length === 0) return
    const scroller = scrollerRef.current
    if (scroller && totalHeight <= scroller.clientHeight + PICKER_GRID_GAP) void load(nextCursor)
  }, [load, loading, loadingMore, nextCursor, scrollerRef, totalHeight, visible.length])

  const toggle = (item: CanvasReferencePickerItem) => {
    if (item.referenced) return
    if (selected.includes(item.id)) {
      setSelected(selected.filter((id) => id !== item.id))
      setError(null)
      return
    }
    if (capacityLeft(item.mediaType) <= 0) {
      setError(`当前模型最多再引用 ${remaining[item.mediaType] ?? 0} 个${TYPE_LABELS[item.mediaType]}，已选满。`)
      return
    }
    setSelected([...selected, item.id])
    setError(null)
  }

  const confirm = () => {
    if (selected.length === 0) return
    const message = onConfirm(selected)
    if (message) setError(message)
  }

  const capacityHints = typesPresent
    .filter((type) => (remaining[type] ?? 0) > 0)
    .map((type) => `${TYPE_LABELS[type]}还可添加 ${capacityLeft(type)} 个`)

  return (
    <CanvasViewportLayer>
      <div
        className="nori-canvas-dialog-scrim"
        data-testid="canvas-reference-picker"
        onMouseDown={(event) => { if (event.currentTarget === event.target) onClose() }}
      >
        <section
          ref={dialogRef}
          className="nori-canvas-dialog nori-canvas-reference-picker"
          role="dialog"
          aria-modal="true"
          aria-labelledby="canvas-reference-picker-title"
          tabIndex={-1}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <header>
            <span id="canvas-reference-picker-title"><LayoutGrid />从画布选择引用素材</span>
            <button type="button" title="关闭" aria-label="关闭" onClick={onClose}><X /></button>
          </header>
          <div className="nori-canvas-reference-picker-toolbar">
            <label className="nori-canvas-reference-picker-search">
              <AppIcon name="search" />
              <input
                autoFocus
                value={query}
                placeholder="搜索画布素材名称"
                aria-label="搜索画布素材"
                onChange={(event) => {
                  setQuery(event.target.value)
                  if (!(event.nativeEvent as InputEvent).isComposing) setAppliedQuery(event.target.value)
                }}
                onCompositionEnd={(event) => setAppliedQuery(event.currentTarget.value)}
              />
            </label>
            {typesPresent.length > 1 ? (
              <div className="nori-canvas-reference-picker-types" role="group" aria-label="素材类型">
                {(['all', ...typesPresent] as const).map((type) => (
                  <button
                    type="button"
                    key={type}
                    aria-pressed={typeFilter === type}
                    className={typeFilter === type ? 'is-active' : ''}
                    onClick={() => setTypeFilter(type)}
                  >
                    {type === 'all'
                      ? `全部 ${resolvedMaterials && appliedQuery.trim() ? resultTotal : items.length}`
                      : `${TYPE_LABELS[type]} ${resolvedMaterials && typeFilter === type ? resultTotal : countByType[type]}`}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div ref={scrollerRef} className="nori-canvas-reference-picker-body" onScroll={scrollGrid} aria-busy={loading || loadingMore}>
            {serverFiltered && loading && visible.length === 0 ? (
              <p className="nori-canvas-reference-picker-empty">正在搜索画布素材…</p>
            ) : loadError && visible.length === 0 ? (
              <div className="nori-canvas-reference-picker-empty" role="alert">
                <span>{loadError}</span>
                <button type="button" onClick={() => setLoadAttempt((value) => value + 1)}>重试</button>
              </div>
            ) : items.length === 0 ? (
              <p className="nori-canvas-reference-picker-empty">
                画布上还没有可引用的素材。先把图片、视频或音频拖进画布，或使用「从素材库选择」。
              </p>
            ) : visible.length === 0 ? (
              <p className="nori-canvas-reference-picker-empty">
                {appliedQuery.trim() ? `没有匹配“${appliedQuery.trim()}”的画布素材` : '该类型暂无可引用的画布素材'}
              </p>
            ) : (
              <div className="nori-canvas-reference-picker-grid" style={{ display: 'block', height: totalHeight }}>
                <div style={{ position: 'relative', height: '100%' }}>
                  {windowedItems.slice(listWindow.start, listWindow.end).map(({ item }, visibleIndex) => {
                    const index = listWindow.start + visibleIndex
                    const order = selected.indexOf(item.id)
                    const isSelected = order >= 0
                    const limited = !isSelected && !item.referenced && capacityLeft(item.mediaType) <= 0
                    const Icon = TYPE_ICONS[item.mediaType]
                    const previewImage = toCanvasDisplayImageUrl(item.preview, 480)
                    const previewVideo = previewImage ? null : toPlayableVideoUrl(item.videoSrc)
                    const previewVideoPoster = previewImage ? null : toVideoPosterUrl(item.videoSrc, 480)
                    return (
                      <button
                        type="button"
                        key={item.id}
                        className={`nori-canvas-reference-picker-tile${isSelected ? ' is-selected' : ''}${item.referenced ? ' is-referenced' : ''}${limited ? ' is-limited' : ''}`}
                        style={{
                          position: 'absolute',
                          top: offsets[index],
                          left: `${(index % PICKER_GRID_COLUMNS) * (100 / PICKER_GRID_COLUMNS)}%`,
                          width: `calc(${100 / PICKER_GRID_COLUMNS}% - ${PICKER_GRID_GAP * (PICKER_GRID_COLUMNS - 1) / PICKER_GRID_COLUMNS}px)`,
                        }}
                        aria-pressed={isSelected}
                        aria-disabled={item.referenced || limited}
                        title={item.referenced ? `${item.title} · 已在引用中` : limited ? `${item.title} · ${TYPE_LABELS[item.mediaType]}已达模型引用上限` : item.title}
                        onClick={() => toggle(item)}
                      >
                        <span className="nori-canvas-reference-picker-preview">
                          {previewImage ? <MediaImage src={previewImage} alt="" fill /> : previewVideoPoster ? <img src={previewVideoPoster} alt="" loading="lazy" decoding="async" /> : previewVideo ? <video src={previewVideo} muted playsInline preload="none" /> : <Icon className="nori-canvas-reference-picker-placeholder" />}
                          <i className="nori-canvas-reference-picker-kind" aria-label={TYPE_LABELS[item.mediaType]}><Icon /></i>
                          {isSelected ? <b className="nori-canvas-reference-picker-order"><Check />{orderLabel(order)}</b> : null}
                          {item.referenced ? <em>已引用</em> : item.wired ? <em className="is-wired">已连线</em> : item.character ? <em className="is-character">角色</em> : null}
                        </span>
                        <span className="nori-canvas-reference-picker-name">{item.title}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
            {loadError && visible.length > 0 ? <p role="alert">{loadError} <button type="button" onClick={() => nextCursor ? void load(nextCursor) : setLoadAttempt((value) => value + 1)}>重试</button></p> : null}
            {nextCursor && !loadingMore ? <button type="button" onClick={() => void load(nextCursor)}>加载更多（已加载 {visible.length} / {resultTotal}）</button> : null}
            {loadingMore ? <p className="nori-canvas-reference-picker-empty">正在加载更多素材…</p> : null}
          </div>
          {error ? <div className="nori-canvas-reference-picker-error" role="alert">{error}</div> : null}
          <footer>
            <span className="nori-canvas-reference-picker-summary">
              <b>已选 {selected.length} 个</b>
              {capacityHints.length > 0 ? <small>{capacityHints.join(' · ')}</small> : null}
            </span>
            <button type="button" onClick={onClose}>取消</button>
            <button type="button" className="is-primary" disabled={selected.length === 0} onClick={confirm}>添加引用</button>
          </footer>
        </section>
      </div>
    </CanvasViewportLayer>
  )
}
