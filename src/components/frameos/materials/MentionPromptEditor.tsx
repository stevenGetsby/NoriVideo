'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { AppIcon } from '@/components/ui/icons'
import { MediaImage } from '@/components/media/MediaImage'
import { toDisplayImageUrl } from '@/lib/media/image-url'
import { findActiveMention, insertPromptMention, splitPromptMentionParts } from './mention-prompt'

export { findActiveMention, insertPromptMention, splitPromptMentionParts } from './mention-prompt'

export interface MentionPromptAsset {
  id?: string
  name: string
  imageUrl?: string | null
  mediaType?: 'text' | 'image' | 'video' | 'audio' | 'model3d'
  description?: string
}

interface Props {
  value: string
  assets: MentionPromptAsset[]
  onChange: (value: string) => void
  placeholder?: string
  minHeight?: number
  className?: string
  menuLabel?: string
  hint?: string | null
  readOnly?: boolean
  onSelectAsset?: (asset: MentionPromptAsset, nextValue: string) => void
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
  const highlightedParts = useMemo(() => splitPromptMentionParts(value, assets), [assets, value])
  const options = useMemo(() => {
    if (!mention) return []
    const query = mention.query.toLowerCase()
    return assets
      .filter((asset, index, list) => list.findIndex((item) => assetKey(item) === assetKey(asset)) === index)
      .filter((asset) => !query || asset.name.toLowerCase().includes(query))
      .slice(0, 8)
  }, [assets, mention])

  useEffect(() => setActiveIndex(0), [mention?.query, mention?.start])

  const refreshMention = (nextValue: string, cursor: number | null) => {
    if (readOnly) {
      setMention(null)
      return
    }
    setMention(findActiveMention(nextValue, cursor ?? nextValue.length))
  }

  const choose = (asset: MentionPromptAsset) => {
    if (readOnly) return
    const textarea = textareaRef.current
    if (!textarea || !mention) return
    const cursor = textarea.selectionStart ?? value.length
    const next = insertPromptMention(value, mention, cursor, asset.name)
    onChange(next.value)
    onSelectAsset?.(asset, next.value)
    setMention(null)
    requestAnimationFrame(() => {
      textarea.focus()
      textarea.setSelectionRange(next.cursor, next.cursor)
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
            refreshMention(event.target.value, event.target.selectionStart)
          }}
          onSelect={(event) => refreshMention(event.currentTarget.value, event.currentTarget.selectionStart)}
          onKeyDown={(event) => {
            if (readOnly) return
            if (!mention) return
            if (event.key === 'Escape') {
              event.preventDefault()
              setMention(null)
              return
            }
            if (options.length === 0) return
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setActiveIndex((current) => (current + 1) % options.length)
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              setActiveIndex((current) => (current - 1 + options.length) % options.length)
            } else if (event.key === 'Enter' || event.key === 'Tab') {
              event.preventDefault()
              choose(options[Math.min(activeIndex, options.length - 1)])
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
          aria-activedescendant={mention && options.length > 0 ? `${listboxId}-${activeIndex}` : undefined}
        />
      </div>
      {!readOnly && mention ? (
        <div id={listboxId} role="listbox" className="mention-prompt-options absolute left-2 right-2 top-full z-30 mt-1 max-h-64 overflow-y-auto rounded-[10px] border border-[var(--fos-border-strong)] bg-[var(--fos-bg-2)] p-1 shadow-2xl">
          <div className="px-2 py-1.5 text-[10px] font-bold uppercase tracking-wide text-[var(--fos-text-4)]">{menuLabel}</div>
          {options.length === 0 ? <div className="mention-prompt-empty px-2 py-3 text-center text-[11px] text-[var(--fos-text-4)]">{assets.length === 0 ? '画布中暂无可引用素材' : '没有匹配的素材'}</div> : options.map((asset, index) => {
            const src = toDisplayImageUrl(asset.imageUrl)
            return (
              <button id={`${listboxId}-${index}`} role="option" aria-selected={index === activeIndex} key={assetKey(asset)} type="button" className={`mention-prompt-option flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-[var(--fos-fill-mid)]${index === activeIndex ? ' is-active' : ''}`} onMouseEnter={() => setActiveIndex(index)} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(asset)}>
                <span className="relative h-8 w-8 shrink-0 overflow-hidden rounded-md bg-black/35">
                  {src ? <MediaImage src={src} alt="" fill sizes="32px" style={{ objectFit: 'cover' }} /> : <AppIcon name={assetIcon(asset)} className="absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 text-white/35" />}
                </span>
                <span className="min-w-0 flex-1"><b className="block truncate text-[12px] font-bold text-white">@{asset.name}</b>{asset.description ? <small className="mt-0.5 block truncate text-[10px] font-normal text-[var(--fos-text-4)]">{asset.description}</small> : null}</span>
              </button>
            )
          })}
        </div>
      ) : null}
      {hint ? <div className="mention-prompt-hint mt-1 text-[11px] text-[var(--fos-text-4)]">{hint}</div> : null}
    </div>
  )
}
