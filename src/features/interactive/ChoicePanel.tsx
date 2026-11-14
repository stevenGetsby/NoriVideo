'use client'

import type { CSSProperties, ReactNode } from 'react'
import { MediaImage } from '@/components/media/MediaImage'
import { choiceOptionParts, resolveChoiceLayout } from '@/lib/interactive/interaction'
import type { StoryChoiceLayout, StoryChoicePanel } from '@/lib/interactive/types'
import { toDisplayImageUrl } from '@/lib/media/image-url'
import './choice-panel.css'

export type ChoicePanelOption = {
  id: string
  label: string
  imageUrl?: string | null
  /** Unlock conditions not met yet: the card stays, cannot be picked, and can send the viewer to the shop. */
  locked?: boolean
}

const display = (url: string | null | undefined) => (url ? toDisplayImageUrl(url) || url : null)

function LockBadge() {
  return (
    <span className="nori-choice-option-lock" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="5" y="10" width="14" height="10" rx="2" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3" />
      </svg>
    </span>
  )
}

/**
 * The question panel viewers see for a timed choice. The player and the node preview in the
 * editor render this same component, so what the creator sees is what the viewer gets.
 * A locked card never uses the native disabled attribute: it must still receive the tap that
 * opens the shop (or the «还没有解锁» hint), while never advancing the story.
 */
export function ChoicePanel({ prompt, options, panelStyle, layout, orientation, onChoose, onLockedPress, header, preview = false, className }: {
  prompt?: string
  options: readonly ChoicePanelOption[]
  panelStyle: StoryChoicePanel
  layout: StoryChoiceLayout
  orientation: 'portrait' | 'landscape'
  /** Absent in the editor preview: the cards render but cannot be pressed. */
  onChoose?: (optionId: string) => void
  /** A locked card was pressed; the player opens its shop item or shows the unlock hint. */
  onLockedPress?: (optionId: string) => void
  /** Rendered above the question, e.g. the countdown bar. */
  header?: ReactNode
  /** Smaller type and spacing for the node preview. */
  preview?: boolean
  className?: string
}) {
  const resolved = resolveChoiceLayout(layout, orientation)
  const parts = options.map((option) => choiceOptionParts(panelStyle, option))
  const textOnly = parts.every((part) => !part.image)
  const count = Math.min(Math.max(options.length, 1), 6)
  return (
    <div
      className={`nori-choice-panel is-${orientation} is-${resolved}${textOnly ? ' is-text-only' : ''}${preview ? ' is-preview' : ''}${className ? ` ${className}` : ''}`}
      data-testid="choice-panel"
      data-layout={resolved}
      data-panel-style={panelStyle}
    >
      {header}
      {prompt ? <p className="nori-choice-prompt">{prompt}</p> : null}
      <div className="nori-choice-options" style={{ '--choice-count': count } as CSSProperties}>
        {options.map((option, index) => {
          const part = parts[index]
          const label = option.label.trim() || `选项${index + 1}`
          const image = part.image ? display(option.imageUrl) : null
          const locked = option.locked === true
          const press = locked ? onLockedPress : onChoose
          return (
            <button
              key={option.id}
              type="button"
              className={`nori-choice-option${image ? ' has-image' : ''}${locked ? ' is-locked' : ''}`}
              data-option-id={option.id}
              data-locked={locked ? 'true' : undefined}
              disabled={locked ? undefined : !press}
              aria-disabled={locked ? true : undefined}
              aria-label={locked ? `未解锁：${label}` : part.text ? undefined : label}
              onClick={press ? () => press(option.id) : undefined}
            >
              {locked ? <LockBadge /> : null}
              {image ? <span className="nori-choice-option-image"><MediaImage src={image} alt="" fill sizes="240px" draggable={false} /></span> : null}
              {part.text || !image ? <span className="nori-choice-option-text">{label}</span> : null}
            </button>
          )
        })}
      </div>
    </div>
  )
}
