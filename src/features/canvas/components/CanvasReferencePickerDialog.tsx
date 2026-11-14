'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { AppIcon } from '@/components/ui/icons'
import { Check, Film, ImageIcon, LayoutGrid, Music2, X } from '@/components/ui/icons'
import { MediaImage } from '@/components/media/MediaImage'
import { filterByFuzzyQuery } from '@/lib/frameos/fuzzy-match'
import { toDisplayImageUrl, toPlayableVideoUrl } from '@/lib/media/image-url'
import {
  CANVAS_REFERENCE_PICKER_TYPES,
  type CanvasReferencePickerItem,
  type CanvasReferencePickerType,
} from '../canvas-reference-picker'
import { CanvasViewportLayer } from './CanvasViewportLayer'

const TYPE_LABELS: Record<CanvasReferencePickerType, string> = { image: '图片', video: '视频', audio: '音频' }
const TYPE_ICONS = { image: ImageIcon, video: Film, audio: Music2 } as const

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

  const visible = useMemo(() => {
    const scoped = typeFilter === 'all' ? items : items.filter((item) => item.mediaType === typeFilter)
    return filterByFuzzyQuery(scoped.map((item) => ({ item, label: item.title })), appliedQuery).map((entry) => entry.item)
  }, [appliedQuery, items, typeFilter])

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
                    {type === 'all' ? `全部 ${items.length}` : `${TYPE_LABELS[type]} ${countByType[type]}`}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div className="nori-canvas-reference-picker-body">
            {items.length === 0 ? (
              <p className="nori-canvas-reference-picker-empty">
                画布上还没有可引用的素材。先把图片、视频或音频拖进画布，或使用「从素材库选择」。
              </p>
            ) : visible.length === 0 ? (
              <p className="nori-canvas-reference-picker-empty">
                {appliedQuery.trim() ? `没有匹配“${appliedQuery.trim()}”的画布素材` : '该类型暂无可引用的画布素材'}
              </p>
            ) : (
              <div className="nori-canvas-reference-picker-grid">
                {visible.map((item) => {
                  const order = selected.indexOf(item.id)
                  const isSelected = order >= 0
                  const limited = !isSelected && !item.referenced && capacityLeft(item.mediaType) <= 0
                  const Icon = TYPE_ICONS[item.mediaType]
                  const previewImage = toDisplayImageUrl(item.preview)
                  const previewVideo = previewImage ? null : toPlayableVideoUrl(item.videoSrc)
                  return (
                    <button
                      type="button"
                      key={item.id}
                      className={`nori-canvas-reference-picker-tile${isSelected ? ' is-selected' : ''}${item.referenced ? ' is-referenced' : ''}${limited ? ' is-limited' : ''}`}
                      aria-pressed={isSelected}
                      aria-disabled={item.referenced || limited}
                      title={item.referenced ? `${item.title} · 已在引用中` : limited ? `${item.title} · ${TYPE_LABELS[item.mediaType]}已达模型引用上限` : item.title}
                      onClick={() => toggle(item)}
                    >
                      <span className="nori-canvas-reference-picker-preview">
                        {previewImage ? <MediaImage src={previewImage} alt="" fill /> : previewVideo ? <video src={previewVideo} muted playsInline preload="metadata" /> : <Icon className="nori-canvas-reference-picker-placeholder" />}
                        <i className="nori-canvas-reference-picker-kind" aria-label={TYPE_LABELS[item.mediaType]}><Icon /></i>
                        {isSelected ? <b className="nori-canvas-reference-picker-order"><Check />{orderLabel(order)}</b> : null}
                        {item.referenced ? <em>已引用</em> : item.wired ? <em className="is-wired">已连线</em> : item.character ? <em className="is-character">角色</em> : null}
                      </span>
                      <span className="nori-canvas-reference-picker-name">{item.title}</span>
                    </button>
                  )
                })}
              </div>
            )}
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
