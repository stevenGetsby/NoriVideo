'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
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

function assetIcon(asset: MentionPromptAsset): 'audioWave' | 'fileText' | 'image' | 'package' | 'video' {
  if (asset.mediaType === 'audio') return 'audioWave'
  if (asset.mediaType === 'video') return 'video'
  if (asset.mediaType === 'text') return 'fileText'
  if (asset.mediaType === 'model3d') return 'package'
  return 'image'
}

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
  const [activeIndex, setActiveIndex] = useState(0)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set())
  const dismissedMentionRef = useRef<{ query: string; start: number } | null>(null)
  const blurTimerRef = useRef<number | null>(null)
  const composingRef = useRef(false)
  const undoInsertionRef = useRef<PromptInsertionRecord | null>(null)
  const redoInsertionRef = useRef<PromptInsertionRecord | null>(null)
  const highlightedParts = useMemo(() => splitPromptMentionParts(value, assets), [assets, value])
  const options = useMemo(() => {
    if (!mention) return []
    const query = mention.query.toLowerCase()
    return assets
      .filter((asset, index, list) => list.findIndex((item) => assetKey(item) === assetKey(asset)) === index)
      .filter((asset) => !query || asset.name.toLowerCase().includes(query))
  }, [assets, mention])
  const grouped = groups.length > 0
  const searching = Boolean(mention?.query)
  const visibleOptions = useMemo(() => options.filter((asset) => (
    !grouped || searching || !asset.category || expandedGroups.has(asset.category)
  )), [expandedGroups, grouped, options, searching])
  const categories = useMemo(() => {
    const labels = new Map<string, string>()
    for (const asset of options) {
      if (!asset.category || labels.has(asset.category)) continue
      labels.set(asset.category, asset.description?.split(' · ')[0] || asset.category)
    }
    return [...labels.entries()].map(([id, label]) => ({ id, label }))
  }, [options])
  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const asset of options) {
      if (asset.category) counts.set(asset.category, (counts.get(asset.category) || 0) + 1)
    }
    return counts
  }, [options])
  const optionIndexes = useMemo(() => new Map(visibleOptions.map((asset, index) => [assetKey(asset), index])), [visibleOptions])
  const connectedShortcuts = useMemo(() => new Map(visibleOptions.flatMap((asset, index) => (
    asset.section === 'connected' ? [[assetKey(asset), index + 1] as const] : []
  ))), [visibleOptions])
  const groupLabel = (id: string) => groups.find((group) => group.id === id)?.label || id
  const expanded = (id: string) => expandedGroups.has(id)

  useEffect(() => {
    if (activeIndex < visibleOptions.length) return
    setActiveIndex(0)
  }, [activeIndex, visibleOptions.length])
  useEffect(() => setActiveIndex(0), [mention?.query, mention?.start])
  useEffect(() => {
    const popup = document.getElementById(listboxId)
    const option = document.getElementById(`${listboxId}-${activeIndex}`)
    if (!popup || !option) return
    const bounds = popup.getBoundingClientRect()
    const item = option.getBoundingClientRect()
    if (item.bottom > bounds.bottom) popup.scrollTop += item.bottom - bounds.bottom
    if (item.top < bounds.top + 36) popup.scrollTop -= bounds.top + 36 - item.top
  }, [activeIndex, listboxId, mention])

  useEffect(() => () => {
    if (blurTimerRef.current !== null) window.clearTimeout(blurTimerRef.current)
  }, [])

  // The textarea value can also change from outside (switching shots, AI edits,
  // clearing a draft). Re-derive an already-open picker so a later Enter/Tab
  // cannot apply a stale @query to the new text.
  useEffect(() => {
    setMention((current) => {
      if (!current) return current
      const textarea = textareaRef.current
      const focused = textarea !== null && document.activeElement === textarea
      const cursor = focused ? textarea.selectionStart : value.length
      return findActiveMention(value, cursor ?? value.length)
    })
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
    setMention(findActiveMention(next.value, next.cursor))
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
      setMention(null)
      return
    }
    const next = findActiveMention(nextValue, cursor ?? nextValue.length)
    const dismissed = dismissedMentionRef.current
    setMention(next && dismissed?.query === next.query && dismissed.start === next.start ? null : next)
  }

  const toggleGroup = (id: string) => {
    setExpandedGroups((current) => {
      const next = new Set(current)
      if (next.has(id)) {
        next.delete(id)
        setActiveIndex(0)
      } else next.add(id)
      return next
    })
  }

  const renderOption = (asset: MentionPromptAsset) => {
    const index = optionIndexes.get(assetKey(asset)) ?? 0
    const src = toDisplayImageUrl(asset.imageUrl)
    return (
      <button id={`${listboxId}-${index}`} role="option" aria-selected={index === activeIndex} key={`${asset.section || ''}:${assetKey(asset)}`} type="button" className={`mention-prompt-option flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-[var(--fos-fill-mid)]${index === activeIndex ? ' is-active' : ''}`} onMouseEnter={() => setActiveIndex(index)} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(asset)}>
        <span className="relative h-8 w-8 shrink-0 overflow-hidden rounded-md bg-black/35">
          {src ? <MediaImage src={src} alt="" fill sizes="32px" style={{ objectFit: 'cover' }} /> : <AppIcon name={assetIcon(asset)} className="absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 text-white/35" />}
        </span>
        <span className="min-w-0 flex-1"><b className="block truncate text-[12px] font-bold text-white">@{asset.name}</b>{asset.description ? <small className="mt-0.5 block truncate text-[10px] font-normal text-[var(--fos-text-4)]">{asset.description}</small> : null}</span>
        {grouped && connectedShortcuts.has(assetKey(asset)) ? <kbd className="mention-prompt-shortcut">#{connectedShortcuts.get(assetKey(asset))}</kbd> : null}
      </button>
    )
  }

  const renderCategory = (id: string, label: string) => {
    const categoryAssets = options.filter((asset) => asset.category === id)
    return (
      <div key={id} className="mention-prompt-category">
        <button type="button" className="mention-prompt-group-button" aria-expanded={searching || expanded(id)} onMouseDown={(event) => event.preventDefault()} onClick={() => toggleGroup(id)}>
          <AppIcon name="chevronRight" className={`mention-prompt-chevron${searching || expanded(id) ? ' is-expanded' : ''}`} />
          <span>{label}</span><small>{categoryCounts.get(id) || 0}</small>
        </button>
        {searching || expanded(id) ? <div className="mention-prompt-category-options">{categoryAssets.map(renderOption)}</div> : null}
      </div>
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
    const selectionStart = textarea.selectionStart ?? liveValue.length
    const selectionEnd = textarea.selectionEnd ?? selectionStart
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
    setMention(null)
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
              dismissedMentionRef.current = mention
              setMention(null)
              return
            }
            if (visibleOptions.length === 0) return
            if (/^[1-9]$/.test(event.key) && grouped && !mention.query) {
              const index = Number(event.key) - 1
              const connected = visibleOptions.filter((asset) => asset.section === 'connected')
              if (index < connected.length) {
                event.preventDefault()
                choose(connected[index])
                return
              }
            }
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setActiveIndex((current) => (current + 1) % visibleOptions.length)
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              setActiveIndex((current) => (current - 1 + visibleOptions.length) % visibleOptions.length)
            } else if (event.key === 'Enter' || event.key === 'Tab') {
              event.preventDefault()
              choose(visibleOptions[Math.min(activeIndex, visibleOptions.length - 1)])
            }
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
            setMention(null)
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
          aria-controls={mention ? listboxId : undefined}
          aria-activedescendant={mention && visibleOptions.length > 0 ? `${listboxId}-${activeIndex}` : undefined}
        />
      </div>
      {!readOnly && mention ? (
        <ViewportPopover anchorRef={textareaRef} onClose={() => setMention(null)} maxHeight={380} id={listboxId} role="listbox" aria-label={menuLabel} className={`mention-prompt-options${grouped ? ' is-grouped' : ''}`}>
          <div className="mention-prompt-options-heading">{menuLabel}<small>{options.length} 项</small></div>
          {grouped && !searching ? <div className="mention-prompt-search-hint">继续输入可搜索全部素材</div> : null}
          {options.length === 0 ? <div className="mention-prompt-empty px-2 py-3 text-center text-[11px] text-[var(--fos-text-4)]">{loading ? '正在加载个人素材库…' : assets.length === 0 ? '暂无可引用素材' : '没有匹配的素材'}</div> : grouped ? (
            <>
              {visibleOptions.some((asset) => asset.section === 'connected') ? <section className="mention-prompt-section"><h3>已连接节点<small>{visibleOptions.filter((asset) => asset.section === 'connected').length}</small></h3>{visibleOptions.filter((asset) => asset.section === 'connected').map(renderOption)}</section> : null}
              {visibleOptions.some((asset) => asset.section === 'secondary') ? <section className="mention-prompt-section"><h3>二级连接节点<small>{visibleOptions.filter((asset) => asset.section === 'secondary').length}</small></h3>{visibleOptions.filter((asset) => asset.section === 'secondary').map(renderOption)}</section> : null}
              {options.some((asset) => asset.section === 'library') ? <section className="mention-prompt-section"><h3>个人素材库<small>{options.filter((asset) => asset.section === 'library').length}</small></h3>{categories.map(({ id }) => renderCategory(id, groupLabel(id)))}</section> : null}
            </>
          ) : options.map(renderOption)}
        </ViewportPopover>
      ) : null}
      {hint ? <div className="mention-prompt-hint mt-1 text-[11px] text-[var(--fos-text-4)]">{hint}</div> : null}
    </div>
  )
}
