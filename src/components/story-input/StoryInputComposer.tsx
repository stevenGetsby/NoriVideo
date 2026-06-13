'use client'

import { useCallback, useEffect, useRef, type CompositionEvent, type ReactNode } from 'react'
import { RatioSelector, StylePresetSelector, StyleSelector } from '@/components/selectors/RatioStyleSelectors'
import { resolveTextareaTargetHeight } from '@/lib/ui/textarea-height'

interface StoryInputComposerOption {
  value: string
  label: string
  recommended?: boolean
}

interface StoryInputComposerStylePresetOption {
  value: string
  label: string
  description: string
}

interface StoryInputComposerProps {
  value: string
  onValueChange: (value: string) => void
  placeholder: string
  minRows: number
  disabled?: boolean
  maxHeightViewportRatio?: number
  topRight?: ReactNode
  footer?: ReactNode
  secondaryActions?: ReactNode
  primaryAction: ReactNode
  videoRatio: string
  onVideoRatioChange: (value: string) => void
  ratioOptions: StoryInputComposerOption[]
  getRatioUsage?: (ratio: string) => string
  artStyle: string
  onArtStyleChange: (value: string) => void
  styleOptions: StoryInputComposerOption[]
  customStyleOptions?: { value: string; label: string }[]
  onAddCustomStyle?: () => void
  onEditCustomStyle?: (value: string) => void
  onDeleteCustomStyle?: (value: string) => void
  stylePresetValue: string
  onStylePresetChange: (value: string) => void
  stylePresetOptions: readonly StoryInputComposerStylePresetOption[]
  onCompositionStart?: () => void
  onCompositionEnd?: (event: CompositionEvent<HTMLTextAreaElement>) => void
  textareaClassName?: string
}

export default function StoryInputComposer({
  value,
  onValueChange,
  placeholder,
  minRows,
  disabled = false,
  maxHeightViewportRatio = 0.5,
  topRight,
  footer,
  secondaryActions,
  primaryAction,
  videoRatio,
  onVideoRatioChange,
  ratioOptions,
  getRatioUsage,
  artStyle,
  onArtStyleChange,
  styleOptions,
  customStyleOptions,
  onAddCustomStyle,
  onEditCustomStyle,
  onDeleteCustomStyle,
  stylePresetValue,
  onStylePresetChange,
  stylePresetOptions,
  onCompositionStart,
  onCompositionEnd,
  textareaClassName,
}: StoryInputComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const textareaMinHeightRef = useRef<number | null>(null)
  // 跟踪是否由外部 value 变更引起的同步（而非用户输入），避免覆盖浏览器 undo 栈
  const lastExternalValueRef = useRef(value)

  const autoResizeTextarea = useCallback(() => {
    const el = textareaRef.current
    if (!el || typeof window === 'undefined') return

    const maxHeight = window.innerHeight * maxHeightViewportRatio
    const oldHeight = el.offsetHeight
    const oldScrollTop = el.scrollTop

    if (textareaMinHeightRef.current === null && oldHeight > 0) {
      textareaMinHeightRef.current = oldHeight
    }

    const minHeight = textareaMinHeightRef.current ?? oldHeight

    el.style.transition = 'none'
    el.style.height = 'auto'
    const scrollHeight = el.scrollHeight
    const targetHeight = resolveTextareaTargetHeight({
      minHeight,
      maxHeight,
      scrollHeight,
    })
    el.style.height = `${oldHeight}px`
    el.scrollTop = oldScrollTop

    requestAnimationFrame(() => {
      el.scrollTop = oldScrollTop
      el.style.transition = 'height 200ms ease-out'
      el.style.height = `${targetHeight}px`
      el.style.overflowY = scrollHeight > maxHeight ? 'auto' : 'hidden'
    })
  }, [maxHeightViewportRatio])

  useEffect(() => {
    autoResizeTextarea()
  }, [value, autoResizeTextarea])

  // 仅在外部 value 变更时（非用户输入）同步到 textarea，保留浏览器 undo 栈
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    if (value !== lastExternalValueRef.current && value !== el.value) {
      el.value = value
    }
    lastExternalValueRef.current = value
  }, [value])

  return (
    <div className="relative w-full glass-surface-elevated rounded-2xl">
      <div className="p-6 pb-4">
        {topRight && (
          <div className="mb-3 flex items-center justify-end">
            {topRight}
          </div>
        )}

        <textarea
          ref={textareaRef}
          defaultValue={value}
          onChange={(event) => {
            lastExternalValueRef.current = event.target.value
            onValueChange(event.target.value)
          }}
          onCompositionStart={onCompositionStart}
          onCompositionEnd={onCompositionEnd}
          placeholder={placeholder}
          rows={minRows}
          disabled={disabled}
          className={`w-full resize-none border-none bg-transparent text-base text-[var(--glass-text-primary)] outline-none placeholder:text-[var(--glass-text-tertiary)] app-scrollbar ${textareaClassName ?? 'p-5 pb-3'}`}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 overflow-visible px-5 pb-4 sm:flex-nowrap sm:overflow-x-auto">
        <div className="flex min-w-0 w-full flex-wrap items-center gap-2 sm:w-auto sm:min-w-max sm:flex-nowrap">
          <div className="w-[118px] flex-shrink-0">
            <RatioSelector
              value={videoRatio}
              onChange={onVideoRatioChange}
              options={ratioOptions}
              getUsage={getRatioUsage}
            />
          </div>
          <div className="w-[132px] flex-shrink-0">
            <StyleSelector
              value={artStyle}
              onChange={onArtStyleChange}
              options={styleOptions}
              customOptions={customStyleOptions}
              onAddCustom={onAddCustomStyle}
              onEditCustom={onEditCustomStyle}
              onDeleteCustom={onDeleteCustomStyle}
            />
          </div>
          {stylePresetOptions.length > 0 ? (
            <div className="w-[152px] flex-shrink-0">
              <StylePresetSelector
                value={stylePresetValue}
                onChange={onStylePresetChange}
                options={stylePresetOptions}
              />
            </div>
          ) : null}
        </div>
        <div className="flex min-w-0 w-full flex-wrap items-center justify-between gap-2 pt-2 sm:ml-auto sm:w-auto sm:min-w-max sm:flex-nowrap sm:justify-start sm:pt-0">
          {secondaryActions}
          {primaryAction}
        </div>
      </div>

      {footer && (
        <div className="px-6 pb-4">
          {footer}
        </div>
      )}
    </div>
  )
}
