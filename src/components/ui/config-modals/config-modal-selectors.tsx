'use client'

/**
 * 项目配置弹窗专用选择器
 * 卡片边框风格：选中时蓝色描边 + 淡色背景 + 加粗文字
 */
import { useEffect, useRef, useState } from 'react'
import { AppIcon } from '@/components/ui/icons'

interface RatioSelectorProps {
  value: string
  onChange: (value: string) => void
  options: Array<{ value: string; label: string }>
}

interface StyleSelectorProps {
  value: string
  onChange: (value: string) => void
  options: Array<{ value: string; label: string }>
  customOptions?: Array<{ value: string; label: string }>
  onAddCustom?: () => void
  onEditCustom?: (value: string) => void
  onDeleteCustom?: (value: string) => void
}

/** 线框比例预览块 */
function RatioShape({ ratio, selected, size = 26 }: { ratio: string; selected: boolean; size?: number }) {
  const [w, h] = ratio.split(':').map(Number)
  const max = Math.max(w, h)
  return (
    <div
      className={`rounded-md border-2 transition-colors ${
        selected ? 'border-[var(--glass-accent-from)]' : 'border-[var(--glass-stroke-strong)]'
      }`}
      style={{
        width: Math.min(size, size * (w / max)),
        height: Math.min(size, size * (h / max)),
      }}
    />
  )
}

export function RatioSelector({ value, onChange, options }: RatioSelectorProps) {
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const selectedOption = options.find((option) => option.value === value)

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="glass-input-base h-11 px-3 flex items-center justify-between gap-2 cursor-pointer transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <RatioShape ratio={value} size={18} selected />
          <span className="text-sm text-[var(--glass-text-primary)] font-medium">
            {selectedOption?.label || value}
          </span>
        </div>
        <AppIcon name="chevronDown" className={`w-4 h-4 text-[var(--glass-text-tertiary)] transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div
          className="glass-surface-modal absolute z-50 mt-1 left-0 right-0 p-3 max-h-60 overflow-y-auto app-scrollbar"
          style={{ minWidth: '300px' }}
        >
          <div className="grid grid-cols-5 gap-2">
            {options.map((option) => {
              const isSelected = value === option.value
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    onChange(option.value)
                    setIsOpen(false)
                  }}
                  className={`flex flex-col items-center gap-2 p-3 rounded-xl border transition-all ${
                    isSelected
                      ? 'border-[var(--glass-accent-from)] bg-[var(--glass-accent-from)]/5 shadow-sm'
                      : 'border-[var(--glass-stroke-soft)] hover:border-[var(--glass-stroke-strong)]'
                  }`}
                >
                  <RatioShape ratio={option.value} size={28} selected={isSelected} />
                  <span className={`text-xs ${isSelected ? 'font-semibold text-[var(--glass-accent-from)]' : 'text-[var(--glass-text-secondary)]'}`}>
                    {option.label}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

export function StyleSelector({ value, onChange, options, customOptions, onAddCustom, onEditCustom, onDeleteCustom }: StyleSelectorProps) {
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const allOptions = [...options, ...(customOptions || [])]
  const selectedOption = allOptions.find((option) => option.value === value) || options[0]

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="glass-input-base h-11 px-3 flex items-center justify-between gap-2 cursor-pointer transition-colors"
      >
        <span className="text-sm text-[var(--glass-text-primary)] font-medium">{selectedOption.label}</span>
        <AppIcon name="chevronDown" className={`w-4 h-4 text-[var(--glass-text-tertiary)] transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="glass-surface-modal absolute z-50 mt-1 left-0 p-3 max-h-80 overflow-y-auto app-scrollbar" style={{ minWidth: '320px' }}>
          <div className="grid grid-cols-2 gap-2">
            {options.map((option) => {
              const isSelected = value === option.value
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    onChange(option.value)
                    setIsOpen(false)
                  }}
                  className={`flex items-center p-3 rounded-xl border text-left transition-all ${
                    isSelected
                      ? 'border-[var(--glass-accent-from)] bg-[var(--glass-accent-from)]/5 shadow-sm'
                      : 'border-[var(--glass-stroke-soft)] hover:border-[var(--glass-stroke-strong)]'
                  }`}
                >
                  <span className={`text-sm whitespace-nowrap ${isSelected ? 'font-semibold text-[var(--glass-accent-from)]' : 'text-[var(--glass-text-secondary)]'}`}>
                    {option.label}
                  </span>
                </button>
              )
            })}
          </div>
          {customOptions && customOptions.length > 0 && (
            <div className="mt-3 border-t border-[var(--glass-stroke-soft)] pt-3">
              <div className="mb-1.5 text-[10px] text-[var(--glass-text-tertiary)]">自定义风格</div>
              <div className="grid grid-cols-2 gap-2">
                {customOptions.map((option) => {
                  const isSelected = value === option.value
                  return (
                    <div key={option.value} className="group relative">
                      <button
                        type="button"
                        onClick={() => { onChange(option.value); setIsOpen(false) }}
                        className={`flex w-full items-center p-3 rounded-xl border text-left transition-all ${
                          isSelected
                            ? 'border-[var(--glass-accent-from)] bg-[var(--glass-accent-from)]/5 shadow-sm'
                            : 'border-[var(--glass-stroke-soft)] hover:border-[var(--glass-stroke-strong)]'
                        }`}
                      >
                        <span className={`text-sm truncate ${isSelected ? 'font-semibold text-[var(--glass-accent-from)]' : 'text-[var(--glass-text-secondary)]'}`}>
                          {option.label}
                        </span>
                      </button>
                      <div className="absolute -top-1 -right-1 hidden gap-0.5 group-hover:flex">
                        {onEditCustom && (
                          <button type="button" onClick={(e) => { e.stopPropagation(); onEditCustom(option.value) }}
                            className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--glass-bg-surface)] text-[var(--glass-text-secondary)] shadow hover:text-[var(--glass-tone-info-fg)]">
                            <AppIcon name="edit" className="h-3 w-3" />
                          </button>
                        )}
                        {onDeleteCustom && (
                          <button type="button" onClick={(e) => { e.stopPropagation(); onDeleteCustom(option.value) }}
                            className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--glass-bg-surface)] text-[var(--glass-text-secondary)] shadow hover:text-[var(--glass-tone-danger-fg)]">
                            <AppIcon name="trash" className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
          {onAddCustom && (
            <button type="button" onClick={onAddCustom}
              className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-[var(--glass-stroke-strong)] p-2.5 text-xs font-medium text-[var(--glass-text-secondary)] transition-colors hover:border-[var(--glass-tone-info-fg)] hover:text-[var(--glass-tone-info-fg)]">
              <AppIcon name="plus" className="h-4 w-4" />
              添加自定义风格
            </button>
          )}
        </div>
      )}
    </div>
  )
}
