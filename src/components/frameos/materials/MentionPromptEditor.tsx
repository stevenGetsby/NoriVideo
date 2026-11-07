'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { AppIcon } from '@/components/ui/icons'
import { MediaImage } from '@/components/media/MediaImage'
import { toDisplayImageUrl } from '@/lib/media/image-url'
import { ViewportPopover } from '@/components/ui/viewport-popover'
import { findActiveMention, insertPromptMention, splitPromptMentionParts } from './mention-prompt'

export { findActiveMention, insertPromptMention, splitPromptMentionParts } from './mention-prompt'

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
  onBlur,
}: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const highlightRef = useRef<HTMLPreElement>(null)
  const listboxId = useId()
  const [mention, setMention] = useState<{ query: string; start: number } | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set())
  const dismissedMentionRef = useRef<{ query: string; start: number } | null>(null)
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

  const refreshMention = (nextValue: string, cursor: number | null) => {
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
    if (!textarea || !mention) return
    const cursor = textarea.selectionStart ?? value.length
    const next = insertPromptMention(value, mention, cursor, asset.name)
    const previousCursor = textarea.selectionStart
    const previousEnd = textarea.selectionEnd
    if (onSelectAsset?.(asset, next.value) === false) return
    onChange(next.value)
    setMention(null)
    requestAnimationFrame(() => {
      textarea.focus()
      if (textarea.selectionStart === previousCursor && textarea.selectionEnd === previousEnd) {
        textarea.setSelectionRange(next.cursor, next.cursor)
      }
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
          onChange={(event) => {
            if (readOnly) return
            onChange(event.target.value)
            if (!mention && /@[^@\s，。；：,\n]*$/u.test(event.target.value.slice(0, event.target.selectionStart))) onMentionOpen?.()
            refreshMention(event.target.value, event.target.selectionStart)
          }}
          onSelect={(event) => {
            if (!mention && findActiveMention(event.currentTarget.value, event.currentTarget.selectionStart)) onMentionOpen?.()
            refreshMention(event.currentTarget.value, event.currentTarget.selectionStart)
          }}
          onKeyDown={(event) => {
            if (readOnly) return
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
          onScroll={(event) => {
            if (!highlightRef.current) return
            highlightRef.current.scrollTop = event.currentTarget.scrollTop
            highlightRef.current.scrollLeft = event.currentTarget.scrollLeft
          }}
          onBlur={() => {
            onBlur?.()
            window.setTimeout(() => setMention(null), 150)
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
              {options.some((asset) => asset.section === 'library') ? <section className="mention-prompt-section"><h3>个人素材库<small>{options.filter((asset) => asset.section === 'library').length}</small></h3>{categories.map(({ id }) => renderCategory(id, groupLabel(id)))}</section> : null}
            </>
          ) : options.map(renderOption)}
        </ViewportPopover>
      ) : null}
      {hint ? <div className="mention-prompt-hint mt-1 text-[11px] text-[var(--fos-text-4)]">{hint}</div> : null}
    </div>
  )
}
