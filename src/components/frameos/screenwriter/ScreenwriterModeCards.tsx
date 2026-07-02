'use client'

import { AppIcon } from '@/components/ui/icons'
import type { ScreenwriterModeCard, ScreenwriterModeKey } from './types'

export function ScreenwriterModeCards({
  cards,
  variant = 'running',
  onSelect,
}: {
  cards: ScreenwriterModeCard[]
  variant?: 'empty' | 'running'
  onSelect: (key: ScreenwriterModeKey) => void
}) {
  if (variant === 'empty') {
    return (
      <div className="mx-auto flex max-w-[820px] flex-col gap-4">
        {cards.map((card) => (
          <button
            key={card.key}
            type="button"
            onClick={() => onSelect(card.key)}
            className="group relative flex items-center gap-5 overflow-hidden rounded-[16px] border border-[var(--fos-border-soft)] bg-[var(--fos-bg-2)] px-6 py-5 text-left transition-colors hover:border-[var(--fos-border-mid)] hover:bg-[var(--fos-bg-3)]"
          >
            <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: card.accent }} />
            <span
              className="flex h-12 w-12 flex-none items-center justify-center rounded-[12px]"
              style={{ background: card.iconBg, color: card.accent }}
            >
              <AppIcon name={card.icon} className="h-6 w-6" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="text-[16px] font-bold text-white">{card.title}</span>
                {card.badge ? <span className="rounded bg-[#3b6ef2] px-1.5 py-0.5 text-[10px] font-bold text-white">{card.badge}</span> : null}
              </span>
              <span className="mt-1 block whitespace-pre-line text-[13px] leading-6 text-[var(--fos-text-3)]">{card.subtitle}</span>
            </span>
            <AppIcon name="chevronRight" className="h-5 w-5 flex-none text-[var(--fos-text-4)]" />
          </button>
        ))}
      </div>
    )
  }

  return (
    <div className="flex flex-wrap gap-2 xl:gap-3">
      {cards.map((card) => (
        <button
          key={card.key}
          type="button"
          onClick={() => onSelect(card.key)}
          className="flex min-h-[82px] items-center gap-3 rounded-[10px] border bg-[var(--fos-bg-2)] px-4 py-3 text-left transition-colors hover:bg-[var(--fos-bg-3)]"
          style={{
            borderColor: card.accent,
            boxShadow: `inset 0 0 0 1px ${card.accent}22`,
            width: card.compact ? 136 : 256,
          }}
        >
          <span
            className="flex h-10 w-10 flex-none items-center justify-center rounded-[9px]"
            style={{ background: card.iconBg, color: card.accent }}
          >
            <AppIcon name={card.icon} className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span className="truncate text-[14px] font-bold text-white">{card.title}</span>
              {card.badge ? <span className="rounded-full bg-[var(--fos-fill-mid)] px-1.5 py-0.5 text-[10px] font-bold text-white">{card.badge}</span> : null}
            </span>
            <span className="mt-1 block whitespace-pre-line text-[12px] leading-5 text-[var(--fos-text-3)]">{card.subtitle}</span>
          </span>
        </button>
      ))}
    </div>
  )
}
