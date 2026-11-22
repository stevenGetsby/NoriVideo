'use client'

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { AppIcon } from '@/components/ui/icons'
import { MediaImage } from '@/components/media/MediaImage'
import { toDisplayImageUrl } from '@/lib/media/image-url'
import { ViewportPopover } from '@/components/ui/viewport-popover'
import {
  findActiveMention,
  isPromptCompositionKey,
  pastePromptAssets,
  redoPromptInsertion,
  replacePromptMention,
  splitPromptMentionParts,
  undoPromptInsertion,
  type PromptInsertionRecord,
} from './mention-prompt'

export {
  findActiveMention,
  insertPromptMention,
  isPromptCompositionKey,
  matchPromptAssetNames,
  pastePromptAssets,
  redoPromptInsertion,
  replacePromptMention,
  splitPromptMentionParts,
  undoPromptInsertion,
} from './mention-prompt'
export type { PromptInsertionRecord } from './mention-prompt'

export interface MentionPromptAsset {
  id?: string
  name: string
  imageUrl?: string | null
  mediaType?: 'text' | 'image' | 'video' | 'audio' | 'model3d'
  description?: string
  section?: string
  category?: string
  materialId?: string | null
}

export interface MentionPromptGroup {
  id: string
  label: string
}

interface Props {
  value: string
  assets: MentionPromptAsset[]
  onChange: (value: string) => void
  placeholder?: string
  minHeight?: number
  className?: string
  menuLabel?: string
  groups?: MentionPromptGroup[]
  loading?: boolean
  onMentionOpen?: () => void
  hint?: string | null
  readOnly?: boolean
  onSelectAsset?: (asset: MentionPromptAsset, nextValue: string) => boolean | void
  onPasteMatch?: (nextValue: string, matchedAssets: MentionPromptAsset[]) => boolean | void
  onBlur?: () => void
}

function assetKey(asset: MentionPromptAsset): string {
  return asset.id ? `id:${asset.id}` : `name:${asset.name}`
}

const MENTION_TOKEN_BREAK = /[@\s，。；：,\n]/u

function sessionStillMatches(value: string, session: { query: string; start: number }): boolean {
  if (value.slice(session.start, session.start + 1 + session.query.length) !== `@${session.query}`) return false
  const after = value[session.start + 1 + session.query.length]
  return after === undefined || MENTION_TOKEN_BREAK.test(after)
}

function mediaIcon(mediaType: MentionPromptAsset['mediaType']): 'audioWave' | 'fileText' | 'image' | 'package' | 'video' {
  if (mediaType === 'audio') return 'audioWave'
  if (mediaType === 'video') return 'video'
  if (mediaType === 'text') return 'fileText'
  if (mediaType === 'model3d') return 'package'
  return 'image'
}

function assetIcon(asset: MentionPromptAsset): 'audioWave' | 'fileText' | 'image' | 'package' | 'video' {
  return mediaIcon(asset.mediaType)
}

const MEDIA_DRILLDOWN_ORDER: readonly NonNullable<MentionPromptAsset['mediaType']>[] = ['image', 'video', 'audio', 'text', 'model3d']
const MEDIA_DRILLDOWN_LABELS: Record<NonNullable<MentionPromptAsset['mediaType']>, string> = {
  image: '图片',
  video: '视频',
  audio: '音频',
  text: '文本',
  model3d: '3D 模型',
}

type MentionMenuRow =
  | { kind: 'asset'; asset: MentionPromptAsset }
  | { kind: 'drilldown'; drillKind: 'media' | 'category'; id: string; label: string }

export function MentionPromptEditor({
  value,
  assets,
  onChange,
  placeholder,
  minHeight = 140,
  className = '',
  menuLabel = '选择分镜素材',
  groups = [],
  loading = false,
  onMentionOpen,
  hint = '输入 @ 可选择当前分镜已添加的素材，提交生成时会按素材顺序转换为“图片1、图片2…”引用。',
  readOnly = false,
  onSelectAsset,
  onPasteMatch,
  onBlur,
}: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const highlightRef = useRef<HTMLPreElement>(null)
  const listboxId = useId()
  const [mention, setMention] = useState<{ query: string; start: number } | null>(null)
  const mentionRef = useRef<{ query: string; start: number } | null>(null)
  const applyMention = (next: { query: string; start: number } | null) => {
    mentionRef.current = next
    setMention(next)
  }
  const [activeIndex, setActiveIndex] = useState(0)
  const [submenu, setSubmenu] = useState<{ kind: 'media' | 'category'; id: string; label: string; keyboard: boolean; activeIndex: number } | null>(null)
  const [searchDraft, setSearchDraft] = useState<string | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const submenuRef = useRef<HTMLDivElement>(null)
  const mentionSessionRef = useRef<{ start: number; query: string } | null>(null)
  const pendingMenuEditRef = useRef<{ value: string; cursor: number } | null>(null)
  const searchComposingRef = useRef(false)
  const menuEditVersionRef = useRef(0)
  const composingVersionRef = useRef<number | null>(null)
  const dismissedMentionRef = useRef<{ query: string; start: number } | null>(null)
  const blurTimerRef = useRef<number | null>(null)
  const composingRef = useRef(false)
  const undoInsertionRef = useRef<PromptInsertionRecord | null>(null)
  const redoInsertionRef = useRef<PromptInsertionRecord | null>(null)
  const highlightedParts = useMemo(() => splitPromptMentionParts(value, assets), [assets, value])
  const options = useMemo(() => {
    if (!mention) return []
    const query = mention.query.toLowerCase()
    const seen = new Set<string>()
    const seenLibraryEntities = new Set<string>()
    return assets
      .filter((asset) => {
        const key = assetKey(asset)
        if (seen.has(key)) return false
        seen.add(key)
        if (asset.section === 'library' && asset.materialId) {
          if (seenLibraryEntities.has(asset.materialId)) return false
          seenLibraryEntities.add(asset.materialId)
        }
        return true
      })
      .filter((asset) => !query || asset.name.toLowerCase().includes(query))
  }, [assets, mention])
  const grouped = groups.length > 0
  const searching = Boolean(mention?.query)
  const drilldown = submenu
  const libraryOptions = useMemo(() => options.filter((asset) => asset.section === 'library'), [options])
  const libraryAliasCategories = useMemo(() => {
    const categories = new Map<string, Set<string>>()
    for (const asset of assets) {
      if (asset.section !== 'library' || !asset.materialId || !asset.category) continue
      const set = categories.get(asset.materialId) || new Set<string>()
      set.add(asset.category)
      categories.set(asset.materialId, set)
    }
    return categories
  }, [assets])
  const assetInDrilldown = (asset: MentionPromptAsset, kind: 'media' | 'category', id: string) => {
    if (kind === 'media') return (asset.mediaType || 'image') === id
    if (asset.category === id) return true
    return Boolean(asset.materialId && libraryAliasCategories.get(asset.materialId)?.has(id))
  }
  const referencedAssets = useMemo(() => (
    grouped && !searching ? options.filter((asset) => asset.section === 'connected' || asset.section === 'secondary') : []
  ), [grouped, options, searching])
  const libraryAssets = useMemo(() => (
    grouped ? libraryOptions : options.filter((asset) => asset.section === 'library')
  ), [grouped, libraryOptions, options])
  const mediaDrilldowns = useMemo(() => {
    if (!grouped || searching) return []
    const counts = new Map<string, number>()
    for (const asset of libraryAssets) {
      const type = asset.mediaType || 'image'
      counts.set(type, (counts.get(type) || 0) + 1)
    }
    return MEDIA_DRILLDOWN_ORDER.filter((type) => counts.has(type)).map((type) => ({ id: type, label: MEDIA_DRILLDOWN_LABELS[type], count: counts.get(type) || 0 }))
  }, [grouped, libraryAssets, searching])
  const categoryDrilldowns = useMemo(() => {
    if (!grouped || searching) return []
    const counts = new Map<string, number>()
    for (const asset of libraryAssets) {
      const categories = asset.materialId ? libraryAliasCategories.get(asset.materialId) : null
      for (const category of categories || (asset.category ? [asset.category] : [])) {
        counts.set(category, (counts.get(category) || 0) + 1)
      }
    }
    return groups.filter((group) => counts.has(group.id)).map((group) => ({ id: group.id, label: group.label, count: counts.get(group.id) || 0 }))
  }, [grouped, groups, libraryAliasCategories, libraryAssets, searching])
  const submenuAssets = useMemo(() => {
    if (!drilldown) return []
    return libraryAssets.filter((asset) => assetInDrilldown(asset, drilldown.kind, drilldown.id))
  }, [drilldown, libraryAssets, libraryAliasCategories])
  const mainRows = useMemo<MentionMenuRow[]>(() => {
    if (!grouped || searching) return options.map((asset) => ({ kind: 'asset', asset }) as MentionMenuRow)
    return [
      ...referencedAssets.map((asset) => ({ kind: 'asset', asset }) as MentionMenuRow),
      ...mediaDrilldowns.map((entry) => ({ kind: 'drilldown', drillKind: 'media', id: entry.id, label: entry.label }) as MentionMenuRow),
      ...categoryDrilldowns.map((entry) => ({ kind: 'drilldown', drillKind: 'category', id: entry.id, label: entry.label }) as MentionMenuRow),
    ]
  }, [categoryDrilldowns, grouped, mediaDrilldowns, options, referencedAssets, searching])
  const assetRowIndexes = useMemo(() => new Map(mainRows.flatMap((row, index) => (
    row.kind === 'asset' ? [[assetKey(row.asset), index] as const] : []
  ))), [mainRows])
  const connectedShortcuts = useMemo(() => {
    let shortcut = 0
    return new Map(mainRows.flatMap((row) => (
      row.kind === 'asset' && row.asset.section === 'connected' ? [[assetKey(row.asset), ++shortcut] as const] : []
    )))
  }, [mainRows])
  const activeMainRow = mainRows[activeIndex] ?? null
  const subFocus = Boolean(submenu?.keyboard)
  const subActiveIndex = submenu?.activeIndex ?? 0

  useEffect(() => {
    if (activeIndex < mainRows.length) return
    setActiveIndex(0)
  }, [activeIndex, mainRows.length])
  useEffect(() => {
    setActiveIndex(0)
  }, [mention?.query, mention?.start])
  useEffect(() => {
    if (!mention) {
      setSubmenu(null)
      mentionSessionRef.current = null
      searchComposingRef.current = false
      composingVersionRef.current = null
      setSearchDraft(null)
    }
  }, [mention])
  useEffect(() => {
    if (searching) setSubmenu(null)
  }, [searching])
  useEffect(() => {
    setSubmenu((current) => {
      if (!current) return current
      const available = current.kind === 'media'
        ? mediaDrilldowns.some((entry) => entry.id === current.id)
        : categoryDrilldowns.some((entry) => entry.id === current.id)
      if (!available) return null
      if (current.activeIndex < submenuAssets.length) return current
      return { ...current, activeIndex: Math.max(0, submenuAssets.length - 1) }
    })
  }, [categoryDrilldowns, mediaDrilldowns, submenuAssets.length])
  useEffect(() => {
    const popup = subFocus ? submenuRef.current : document.getElementById(listboxId)
    const item = popup?.querySelector<HTMLElement>('.is-active')
    if (!popup || !item) return
    const bounds = popup.getBoundingClientRect()
    const itemBounds = item.getBoundingClientRect()
    if (itemBounds.bottom > bounds.bottom) popup.scrollTop += itemBounds.bottom - bounds.bottom
    const headerOffset = subFocus ? 8 : 44
    if (itemBounds.top < bounds.top + headerOffset) popup.scrollTop -= bounds.top + headerOffset - itemBounds.top
  }, [activeIndex, listboxId, mention, subActiveIndex, subFocus])
  const placeSubmenu = () => {
    const submenuEl = submenuRef.current
    if (!submenuEl || !submenu) return
    const row = document.getElementById(`${listboxId}-row-${submenu.kind}-${submenu.id}`)
    const popup = document.getElementById(listboxId)
    if (!row || !popup) return
    const rowRect = row.getBoundingClientRect()
    const popupRect = popup.getBoundingClientRect()
    const viewport = window.visualViewport
    const viewLeft = viewport?.offsetLeft || 0
    const viewTop = viewport?.offsetTop || 0
    const viewWidth = viewport?.width || window.innerWidth
    const viewHeight = viewport?.height || window.innerHeight
    const margin = 12
    const gap = 4
    let left = popupRect.left - gap - submenuEl.offsetWidth
    if (left < viewLeft + margin) left = Math.min(popupRect.right + gap, viewLeft + viewWidth - margin - submenuEl.offsetWidth)
    const maxTop = viewTop + viewHeight - margin - submenuEl.offsetHeight
    submenuEl.style.left = `${Math.max(viewLeft + margin, left)}px`
    submenuEl.style.top = `${Math.max(viewTop + margin, Math.min(rowRect.top, maxTop))}px`
    submenuEl.style.zIndex = String((Number.parseInt(popup.style.zIndex, 10) || 2700) + 1)
    submenuEl.style.visibility = 'visible'
  }
  const placeSubmenuRef = useRef(placeSubmenu)
  placeSubmenuRef.current = placeSubmenu
  useLayoutEffect(() => {
    const submenuEl = submenuRef.current
    if (!submenuEl || !submenu) return
    const place = () => placeSubmenuRef.current()
    place()
    const popup = document.getElementById(listboxId)
    const observer = new ResizeObserver(place)
    observer.observe(submenuEl)
    if (popup) observer.observe(popup)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    window.visualViewport?.addEventListener('resize', place)
    window.visualViewport?.addEventListener('scroll', place)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
      window.visualViewport?.removeEventListener('resize', place)
      window.visualViewport?.removeEventListener('scroll', place)
    }
  }, [listboxId, submenu])

  useEffect(() => () => {
    if (blurTimerRef.current !== null) window.clearTimeout(blurTimerRef.current)
  }, [])

  // The textarea value can also change from outside (switching shots, AI edits,
  // clearing a draft). Re-derive an already-open picker so a later Enter/Tab
  // cannot apply a stale @query to the new text.
  useEffect(() => {
    const pending = pendingMenuEditRef.current
    if (pending && pending.value === value) {
      pendingMenuEditRef.current = null
      const next = findActiveMention(value, pending.cursor)
      if (next) mentionSessionRef.current = next
      applyMention(next)
      const textarea = textareaRef.current
      if (textarea && document.activeElement !== searchInputRef.current) {
        requestAnimationFrame(() => {
          const current = textareaRef.current
          if (!current || current.value !== pending.value || document.activeElement === searchInputRef.current) return
          current.setSelectionRange(pending.cursor, pending.cursor)
        })
      }
      return
    }
    pendingMenuEditRef.current = null
    menuEditVersionRef.current += 1
    {
      const current = mentionRef.current
      if (!current) return
      const textarea = textareaRef.current
      if (textarea !== null && document.activeElement === textarea) {
        const next = findActiveMention(value, textarea.selectionStart ?? value.length)
        if (next) mentionSessionRef.current = next
        applyMention(next)
        return
      }
      const session = mentionSessionRef.current
      if (session && sessionStillMatches(value, session)) {
        const next = findActiveMention(value, session.start + 1 + session.query.length)
        if (next && next.start === session.start) {
          mentionSessionRef.current = next
          applyMention(next)
          return
        }
      }
      mentionSessionRef.current = null
      applyMention(null)
    }
  }, [value])

  const cancelBlurDismissal = () => {
    if (blurTimerRef.current !== null) window.clearTimeout(blurTimerRef.current)
    blurTimerRef.current = null
  }

  const clearInsertionHistory = () => {
    undoInsertionRef.current = null
    redoInsertionRef.current = null
  }

  const rememberInsertion = (record: PromptInsertionRecord) => {
    undoInsertionRef.current = record
    redoInsertionRef.current = null
  }

  const applyHistoryValue = (next: { value: string; cursor: number }) => {
    onChange(next.value)
    const restored = findActiveMention(next.value, next.cursor)
    if (restored) mentionSessionRef.current = restored
    applyMention(restored)
    requestAnimationFrame(() => {
      const current = textareaRef.current
      if (!current || current.value !== next.value) return
      current.focus()
      current.setSelectionRange(next.cursor, next.cursor)
    })
  }

  const refreshMention = (nextValue: string, cursor: number | null) => {
    cancelBlurDismissal()
    if (readOnly) {
      applyMention(null)
      return
    }
    const next = findActiveMention(nextValue, cursor ?? nextValue.length)
    if (next) mentionSessionRef.current = next
    const dismissed = dismissedMentionRef.current
    applyMention(next && dismissed?.query === next.query && dismissed.start === next.start ? null : next)
  }

  const openDrilldown = (kind: 'media' | 'category', id: string, label: string, rowIndex: number, keyboard: boolean) => {
    setActiveIndex(rowIndex)
    setSubmenu((current) => {
      if (current?.kind === kind && current.id === id) return { ...current, keyboard: current.keyboard || keyboard }
      return { kind, id, label, keyboard, activeIndex: 0 }
    })
  }

  const closeDrilldown = () => {
    setSubmenu(null)
  }

  const dismissMention = () => {
    if (mention) dismissedMentionRef.current = mention
    mentionSessionRef.current = null
    pendingMenuEditRef.current = null
    searchComposingRef.current = false
    composingVersionRef.current = null
    applyMention(null)
  }

  const commitSearchQuery = (query: string, caret: number) => {
    const textarea = textareaRef.current
    const session = mentionSessionRef.current ?? mention
    if (!textarea || !session) return
    const liveValue = textarea.value
    if (!sessionStillMatches(liveValue, session)) {
      mentionSessionRef.current = null
      pendingMenuEditRef.current = null
      applyMention(null)
      return
    }
    const nextValue = `${liveValue.slice(0, session.start + 1)}${query}${liveValue.slice(session.start + 1 + session.query.length)}`
    const nextMention = findActiveMention(nextValue, session.start + 1 + query.length)
    if (nextMention) mentionSessionRef.current = nextMention
    applyMention(nextMention)
    menuEditVersionRef.current += 1
    pendingMenuEditRef.current = { value: nextValue, cursor: session.start + 1 + query.length }
    onChange(nextValue)
    requestAnimationFrame(() => {
      searchInputRef.current?.setSelectionRange(caret, caret)
    })
  }

  const activateRow = (row: MentionMenuRow, index: number) => {
    if (row.kind === 'asset') {
      choose(row.asset)
      return
    }
    openDrilldown(row.drillKind, row.id, row.label, index, true)
  }

  const moveMainHighlight = (delta: number) => {
    if (mainRows.length === 0) return
    const next = (activeIndex + delta + mainRows.length) % mainRows.length
    setActiveIndex(next)
    setSubmenu(null)
  }

  const handleMenuKeyDown = (event: ReactKeyboardEvent) => {
    if (isPromptCompositionKey(event)) return
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      dismissMention()
      requestAnimationFrame(() => textareaRef.current?.focus())
      return
    }
    if (subFocus) {
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        closeDrilldown()
        return
      }
      if (submenuAssets.length === 0) return
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setSubmenu((current) => current && { ...current, activeIndex: (current.activeIndex + 1) % submenuAssets.length })
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        setSubmenu((current) => current && { ...current, activeIndex: (current.activeIndex - 1 + submenuAssets.length) % submenuAssets.length })
      } else if (event.key === 'Enter' || event.key === 'Tab' || event.key === 'ArrowRight') {
        event.preventDefault()
        choose(submenuAssets[Math.min(subActiveIndex, submenuAssets.length - 1)])
      }
      return
    }
    if (mainRows.length === 0) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      moveMainHighlight(1)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      moveMainHighlight(-1)
    } else if (event.key === 'ArrowRight' || event.key === 'Enter' || event.key === 'Tab') {
      const index = Math.min(activeIndex, mainRows.length - 1)
      const row = mainRows[index]
      event.preventDefault()
      if (event.key === 'ArrowRight' && row.kind === 'asset') return
      activateRow(row, index)
    }
  }

  const renderOption = (asset: MentionPromptAsset, index: number, scope: 'main' | 'sub') => {
    const isActive = scope === 'sub' ? subFocus && index === subActiveIndex : !subFocus && index === activeIndex
    const src = toDisplayImageUrl(asset.imageUrl)
    return (
      <button id={scope === 'main' ? `${listboxId}-${index}` : `${listboxId}-sub-${index}`} role="option" aria-selected={isActive} tabIndex={-1} key={`${scope}:${asset.section || ''}:${assetKey(asset)}`} type="button" className={`mention-prompt-option flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-[var(--fos-fill-mid)]${isActive ? ' is-active' : ''}`} onMouseEnter={() => { if (scope === 'sub') { setSubmenu((current) => current && { ...current, keyboard: true, activeIndex: index }) } else { setActiveIndex(index); setSubmenu(null) } }} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(asset)}>
        <span className="relative h-8 w-8 shrink-0 overflow-hidden rounded-md bg-black/35">
          {src ? <MediaImage src={src} alt="" fill sizes="32px" style={{ objectFit: 'cover' }} /> : <AppIcon name={assetIcon(asset)} className="absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 text-white/35" />}
        </span>
        <span className="min-w-0 flex-1"><b className="block truncate text-[12px] font-bold text-white">{grouped ? asset.name : `@${asset.name}`}</b>{!grouped && asset.description ? <small className="mt-0.5 block truncate text-[10px] font-normal text-[var(--fos-text-4)]">{asset.description}</small> : null}</span>
        {grouped && !searching && scope === 'main' && connectedShortcuts.has(assetKey(asset)) ? <kbd className="mention-prompt-shortcut">#{connectedShortcuts.get(assetKey(asset))}</kbd> : null}
      </button>
    )
  }

  const renderDrilldownRow = (kind: 'media' | 'category', id: string, label: string, count: number, icon: Parameters<typeof AppIcon>[0]['name'], rowIndex: number) => {
    const isOpen = drilldown?.kind === kind && drilldown.id === id
    const isActive = !subFocus && rowIndex === activeIndex
    return (
      <button id={`${listboxId}-row-${kind}-${id}`} key={`${kind}:${id}`} type="button" role="menuitem" tabIndex={-1} aria-haspopup="listbox" aria-expanded={isOpen} className={`mention-prompt-drilldown${isOpen || isActive ? ' is-active' : ''}`} onMouseEnter={() => openDrilldown(kind, id, label, rowIndex, false)} onMouseDown={(event) => event.preventDefault()} onClick={() => openDrilldown(kind, id, label, rowIndex, true)}>
        <AppIcon name={icon} className="mention-prompt-drilldown-icon" />
        <span>{label}</span>
        <small>{count}</small>
        <AppIcon name="chevronRight" className="mention-prompt-drilldown-chevron" />
      </button>
    )
  }

  const choose = (asset: MentionPromptAsset) => {
    if (readOnly) return
    const textarea = textareaRef.current
    if (!textarea) return
    // Always resolve against the live DOM text and caret. React state/props can
    // trail behind during deletion, undo/redo and IME composition, which is how
    // the picker used to insert at the wrong index.
    const liveValue = textarea.value
    const editorFocused = document.activeElement === textarea
    const session = mentionSessionRef.current
    const sessionValid = session && sessionStillMatches(liveValue, session)
    const selectionStart = editorFocused ? (textarea.selectionStart ?? liveValue.length) : sessionValid ? session.start + 1 + session.query.length : liveValue.length
    const selectionEnd = editorFocused ? (textarea.selectionEnd ?? selectionStart) : selectionStart
    const liveMention = findActiveMention(liveValue, selectionStart) ?? mention
    const next = replacePromptMention(liveValue, liveMention, selectionStart, selectionEnd, asset.name, assets)
    if (!next) return
    if (onSelectAsset?.(asset, next.value) === false) return
    if (next.value !== liveValue) {
      rememberInsertion({
        before: liveValue,
        after: next.value,
        cursorBefore: selectionStart,
        cursorAfter: next.cursor,
      })
    }
    onChange(next.value)
    applyMention(null)
    mentionSessionRef.current = null
    requestAnimationFrame(() => {
      const current = textareaRef.current
      if (!current || current.value !== next.value) return
      current.focus()
      current.setSelectionRange(next.cursor, next.cursor)
    })
  }

  return (
    <div className={`relative ${className}`}>
      <div className="mention-prompt-editor-layer">
        {value ? (
          <pre ref={highlightRef} className="mention-prompt-highlight" aria-hidden="true">
            {highlightedParts.map((part, index) => (
              part.mention
                ? <mark key={`${index}:${part.text}`} className="mention-prompt-highlight__asset">{part.text}</mark>
                : <span key={`${index}:${part.text}`}>{part.text}</span>
            ))}
            {value.endsWith('\n') ? '\n' : null}
          </pre>
        ) : null}
        <textarea
          ref={textareaRef}
          className={`fos-textarea mention-prompt-textarea w-full${value ? ' mention-prompt-textarea--highlighted' : ''}`}
          style={{ minHeight }}
          value={value}
          readOnly={readOnly}
          aria-readonly={readOnly}
          onFocus={cancelBlurDismissal}
          onCompositionStart={() => {
            composingRef.current = true
            clearInsertionHistory()
          }}
          onCompositionEnd={(event) => {
            composingRef.current = false
            refreshMention(event.currentTarget.value, event.currentTarget.selectionStart)
          }}
          onChange={(event) => {
            if (readOnly) return
            clearInsertionHistory()
            onChange(event.target.value)
            if (!mention && /@[^@\s，。；：,\n]*$/u.test(event.target.value.slice(0, event.target.selectionStart))) onMentionOpen?.()
            refreshMention(event.target.value, event.target.selectionStart)
          }}
          onSelect={(event) => {
            if (document.activeElement !== event.currentTarget) return
            if (!composingRef.current && !mention && findActiveMention(event.currentTarget.value, event.currentTarget.selectionStart)) onMentionOpen?.()
            refreshMention(event.currentTarget.value, event.currentTarget.selectionStart)
          }}
          onKeyDown={(event) => {
            if (readOnly) return
            // The IME owns Enter/Tab/Arrow/Escape/number keys while composing.
            // Hijacking them used to replace the composed text with a mention.
            if (isPromptCompositionKey(event)) return
            if ((event.metaKey || event.ctrlKey) && !event.altKey) {
              const isUndo = !event.shiftKey && (event.key === 'z' || event.key === 'Z')
              const isRedo = (event.shiftKey && (event.key === 'z' || event.key === 'Z'))
                || (!event.shiftKey && (event.key === 'y' || event.key === 'Y'))
              if (isUndo) {
                const record = undoInsertionRef.current
                const next = undoPromptInsertion(event.currentTarget.value, record)
                if (record && next) {
                  event.preventDefault()
                  undoInsertionRef.current = null
                  redoInsertionRef.current = record
                  applyHistoryValue(next)
                  return
                }
              }
              if (isRedo) {
                const record = redoInsertionRef.current
                const next = redoPromptInsertion(event.currentTarget.value, record)
                if (record && next) {
                  event.preventDefault()
                  redoInsertionRef.current = null
                  undoInsertionRef.current = record
                  applyHistoryValue(next)
                  return
                }
              }
            }
            if (!mention) return
            if (event.key === 'Escape') {
              event.preventDefault()
              event.nativeEvent.preventDefault()
              event.stopPropagation()
              dismissMention()
              return
            }
            if (mainRows.length === 0) return
            if (/^[1-9]$/.test(event.key) && grouped && !mention.query && !subFocus) {
              const index = Number(event.key) - 1
              const connected = mainRows.flatMap((row) => (row.kind === 'asset' && row.asset.section === 'connected' ? [row.asset] : []))
              if (index < connected.length) {
                event.preventDefault()
                choose(connected[index])
                return
              }
            }
            handleMenuKeyDown(event)
          }}
          onPaste={(event) => {
            if (readOnly) return
            const pastedText = event.clipboardData?.getData('text/plain')
            if (!pastedText) return
            const liveValue = event.currentTarget.value
            const selectionStart = event.currentTarget.selectionStart ?? liveValue.length
            const selectionEnd = event.currentTarget.selectionEnd ?? selectionStart
            const result = pastePromptAssets(liveValue, selectionStart, selectionEnd, pastedText, assets)
            if (!result) return
            const byName = new Map<string, MentionPromptAsset>()
            for (const asset of assets) {
              const key = asset.name.trim().replace(/^@+/, '').toLocaleLowerCase()
              if (key && !byName.has(key)) byName.set(key, asset)
            }
            const matchedAssets = result.matched.flatMap((name) => {
              const asset = byName.get(name.toLocaleLowerCase())
              return asset ? [asset] : []
            })
            if (matchedAssets.length === 0) return
            if (onPasteMatch?.(result.value, matchedAssets) === false) return
            event.preventDefault()
            if (result.value !== liveValue) {
              rememberInsertion({
                before: liveValue,
                after: result.value,
                cursorBefore: selectionStart,
                cursorAfter: result.cursor,
              })
            }
            onChange(result.value)
            applyMention(null)
            mentionSessionRef.current = null
            requestAnimationFrame(() => {
              const textarea = textareaRef.current
              if (!textarea || textarea.value !== result.value) return
              textarea.focus()
              textarea.setSelectionRange(result.cursor, result.cursor)
            })
          }}
          onScroll={(event) => {
            if (!highlightRef.current) return
            requestAnimationFrame(() => {
              if (!highlightRef.current) return
              highlightRef.current.scrollTop = event.currentTarget.scrollTop
              highlightRef.current.scrollLeft = event.currentTarget.scrollLeft
            })
          }}
          onBlur={() => {
            onBlur?.()
            cancelBlurDismissal()
          }}
          placeholder={placeholder}
          spellCheck={false}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={Boolean(mention)}
          aria-controls={mention ? (subFocus ? `${listboxId}-submenu` : listboxId) : undefined}
          aria-activedescendant={mention ? (subFocus && submenuAssets.length > 0 ? `${listboxId}-sub-${subActiveIndex}` : activeMainRow ? (activeMainRow.kind === 'asset' ? `${listboxId}-${activeIndex}` : `${listboxId}-row-${activeMainRow.drillKind}-${activeMainRow.id}`) : undefined) : undefined}
        />
      </div>
      {!readOnly && mention ? (
        <ViewportPopover
          anchorRef={textareaRef}
          onClose={dismissMention}
          maxHeight={380}
          width={grouped ? 300 : undefined}
          id={listboxId}
          role="listbox"
          aria-label={menuLabel}
          className={`mention-prompt-options${grouped ? ' is-grouped' : ''}`}
          containsNode={(node) => Boolean(submenuRef.current?.contains(node))}
          onReposition={() => placeSubmenuRef.current()}
          onKeyDown={(event) => {
            if (searchComposingRef.current || isPromptCompositionKey(event)) {
              event.preventDefault()
              return
            }
            handleMenuKeyDown(event)
          }}
        >
          {grouped ? (
            <div className="mention-prompt-search">
              <AppIcon name="search" className="mention-prompt-search-icon" />
              <input
                ref={searchInputRef}
                type="text"
                className="mention-prompt-search-input"
                placeholder="搜索"
                value={searchDraft ?? mention.query}
                aria-label="搜索素材"
                role="combobox"
                aria-expanded
                aria-controls={subFocus ? `${listboxId}-submenu` : listboxId}
                aria-autocomplete="list"
                aria-activedescendant={subFocus && submenuAssets.length > 0 ? `${listboxId}-sub-${subActiveIndex}` : activeMainRow ? (activeMainRow.kind === 'asset' ? `${listboxId}-${activeIndex}` : `${listboxId}-row-${activeMainRow.drillKind}-${activeMainRow.id}`) : undefined}
                onCompositionStart={() => {
                  searchComposingRef.current = true
                  composingVersionRef.current = menuEditVersionRef.current
                }}
                onCompositionEnd={(event) => {
                  searchComposingRef.current = false
                  setSearchDraft(null)
                  const stale = composingVersionRef.current !== null && composingVersionRef.current !== menuEditVersionRef.current
                  composingVersionRef.current = null
                  if (stale) return
                  commitSearchQuery(event.currentTarget.value, event.currentTarget.selectionStart ?? event.currentTarget.value.length)
                }}
                onChange={(event) => {
                  if (searchComposingRef.current) {
                    setSearchDraft(event.target.value)
                    return
                  }
                  setSearchDraft(null)
                  commitSearchQuery(event.target.value, event.target.selectionStart ?? event.target.value.length)
                }}
                onFocus={() => {
                  cancelBlurDismissal()
                  const session = mentionSessionRef.current ?? mention
                  if (session) mentionSessionRef.current = session
                }}
              />
            </div>
          ) : <div className="mention-prompt-options-heading">{menuLabel}<small>{options.length} 项</small></div>}
          {options.length === 0 ? <div className="mention-prompt-empty px-2 py-3 text-center text-[11px] text-[var(--fos-text-4)]">{loading ? '正在加载个人素材库…' : assets.length === 0 ? '暂无可引用素材' : '没有匹配的素材'}</div> : grouped && !searching ? (
            <>
              {referencedAssets.length > 0 ? (
                <section className="mention-prompt-section" aria-label="已引用">
                  <h3>已引用</h3>
                  {referencedAssets.map((asset) => renderOption(asset, assetRowIndexes.get(assetKey(asset)) ?? 0, 'main'))}
                </section>
              ) : null}
              {mediaDrilldowns.length > 0 || categoryDrilldowns.length > 0 ? (
                <section className="mention-prompt-section" aria-label="素材引用">
                  <h3>素材引用</h3>
                  {mediaDrilldowns.map(({ id, label, count }, mediaIndex) => renderDrilldownRow('media', id, label, count, mediaIcon(id), referencedAssets.length + mediaIndex))}
                  {mediaDrilldowns.length > 0 && categoryDrilldowns.length > 0 ? <div className="mention-prompt-drilldown-divider" role="separator" /> : null}
                  {categoryDrilldowns.map(({ id, label, count }, categoryIndex) => renderDrilldownRow('category', id, label, count, id === 'favorites' ? 'folderHeart' : 'folder', referencedAssets.length + mediaDrilldowns.length + categoryIndex))}
                </section>
              ) : null}
              {referencedAssets.length === 0 && mediaDrilldowns.length === 0 && categoryDrilldowns.length === 0 ? <div className="mention-prompt-empty px-2 py-3 text-center text-[11px] text-[var(--fos-text-4)]">{loading ? '正在加载个人素材库…' : '暂无可引用素材'}</div> : null}
            </>
          ) : grouped ? (
            <section className="mention-prompt-section" aria-label="搜索结果">
              {options.map((asset, index) => renderOption(asset, index, 'main'))}
            </section>
          ) : options.map((asset, index) => renderOption(asset, index, 'main'))}
        </ViewportPopover>
      ) : null}
      {!readOnly && mention && grouped && !searching && drilldown ? createPortal(
        <div ref={submenuRef} id={`${listboxId}-submenu`} className="nori-viewport-popover mention-prompt-options is-grouped mention-prompt-submenu nodrag nowheel" role="listbox" aria-label={drilldown.label} style={{ position: 'fixed', visibility: 'hidden', zIndex: 2701, width: 300, maxHeight: 380, overflowY: 'auto', overscrollBehavior: 'contain', boxSizing: 'border-box' }} onPointerDown={(event) => event.stopPropagation()}>
          {submenuAssets.length > 0
            ? submenuAssets.map((asset, index) => renderOption(asset, index, 'sub'))
            : <div className="mention-prompt-empty px-2 py-3 text-center text-[11px] text-[var(--fos-text-4)]">该分类暂无素材</div>}
        </div>,
        document.body,
      ) : null}
      {hint ? <div className="mention-prompt-hint mt-1 text-[11px] text-[var(--fos-text-4)]">{hint}</div> : null}
    </div>
  )
}
