'use client'

import { AppIcon } from '@/components/ui/icons'

interface ArtStyleOption {
  value: string
  label: string
}

interface ArtStyleGridSelectorProps {
  value: string
  onChange: (value: string) => void
  options: ArtStyleOption[]
  customOptions?: ArtStyleOption[]
  onAddCustom?: () => void
  onEditCustom?: (value: string) => void
  onDeleteCustom?: (value: string) => void
}

export function ArtStyleGridSelector({
  value,
  onChange,
  options,
  customOptions,
  onAddCustom,
  onEditCustom,
  onDeleteCustom,
}: ArtStyleGridSelectorProps) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        {options.map((option) => {
          const isSelected = value === option.value
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onChange(option.value)}
              className={`glass-btn-base px-3 py-2 rounded-lg text-sm border transition-all justify-start ${
                isSelected
                  ? 'glass-btn-tone-info border-[var(--glass-stroke-focus)]'
                  : 'glass-btn-soft border-[var(--glass-stroke-base)] text-[var(--glass-text-secondary)] hover:border-[var(--glass-stroke-strong)]'
              }`}
            >
              <span>{option.label}</span>
            </button>
          )
        })}
      </div>

      {customOptions && customOptions.length > 0 ? (
        <div className="space-y-2">
          <div className="text-xs text-[var(--glass-text-tertiary)]">自定义画风</div>
          <div className="grid grid-cols-2 gap-2">
            {customOptions.map((option) => {
              const isSelected = value === option.value
              return (
                <div key={option.value} className="group relative">
                  <button
                    type="button"
                    onClick={() => onChange(option.value)}
                    className={`glass-btn-base w-full px-3 py-2 rounded-lg text-sm border transition-all justify-start ${
                      isSelected
                        ? 'glass-btn-tone-info border-[var(--glass-stroke-focus)]'
                        : 'glass-btn-soft border-[var(--glass-stroke-base)] text-[var(--glass-text-secondary)] hover:border-[var(--glass-stroke-strong)]'
                    }`}
                  >
                    <span className="truncate">{option.label}</span>
                  </button>
                  <div className="absolute -top-1 -right-1 hidden gap-1 group-hover:flex">
                    {onEditCustom ? (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation()
                          onEditCustom(option.value)
                        }}
                        className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--glass-bg-surface)] text-[var(--glass-text-secondary)] shadow hover:text-[var(--glass-tone-info-fg)]"
                        title="编辑"
                      >
                        <AppIcon name="edit" className="h-3 w-3" />
                      </button>
                    ) : null}
                    {onDeleteCustom ? (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation()
                          onDeleteCustom(option.value)
                        }}
                        className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--glass-bg-surface)] text-[var(--glass-text-secondary)] shadow hover:text-[var(--glass-tone-danger-fg)]"
                        title="删除"
                      >
                        <AppIcon name="trash" className="h-3 w-3" />
                      </button>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ) : null}

      {onAddCustom ? (
        <button
          type="button"
          onClick={onAddCustom}
          className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-[var(--glass-stroke-strong)] p-2.5 text-xs font-medium text-[var(--glass-text-secondary)] transition-colors hover:border-[var(--glass-tone-info-fg)] hover:text-[var(--glass-tone-info-fg)]"
        >
          <AppIcon name="plus" className="h-4 w-4" />
          添加自定义画风
        </button>
      ) : null}
    </div>
  )
}
