'use client'

import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { AppIcon } from '@/components/ui/icons'
import { filterByFuzzyQuery } from '@/lib/frameos/fuzzy-match'
import {
  moveAssignmentFilterOptionIndex,
  shouldDeferAssignmentFilterActivationToNestedButton,
} from './assignments-view-model'

export interface FilterSelectOption {
  value: string
  label: string
}

export function FosFilterSelect({
  value,
  placeholder,
  options,
  searchable = false,
  allowClear = true,
  disabled = false,
  loading = false,
  testId,
  ariaLabel,
  className,
  emptyText = '无数据',
  onChange,
}: {
  value: string
  placeholder: string
  options: FilterSelectOption[]
  searchable?: boolean
  allowClear?: boolean
  disabled?: boolean
  loading?: boolean
  testId?: string
  ariaLabel?: string
  className?: string
  emptyText?: string
  onChange: (value: string) => void
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const listboxId = useId()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [appliedQuery, setAppliedQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const filterName = placeholder.replace(/^全部/, '')
  const accessibleName = ariaLabel || `筛选${filterName}`
  const selected = options.find((option) => option.value === value)
  const filtered = filterByFuzzyQuery(options, appliedQuery)
  const selectableOptions = filtered
  const activeOptionId = open && selectableOptions[activeIndex]
    ? `${listboxId}-option-${activeIndex}`
    : undefined

  const updateQuery = (next: string, composing = false) => {
    setQuery(next)
    if (!composing) setAppliedQuery(next)
  }

  const openSelect = () => {
    const selectedIndex = selectableOptions.findIndex((option) => option.value === value)
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0)
    setOpen(true)
  }

  const chooseOption = (nextValue: string) => {
    onChange(nextValue)
    setOpen(false)
    triggerRef.current?.focus()
  }

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return
    if (shouldDeferAssignmentFilterActivationToNestedButton(event.key, event.target, event.currentTarget)) return
    if (event.key === 'Escape' && open) {
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
      triggerRef.current?.focus()
      return
    }
    if (!open && event.key === 'Enter') {
      event.preventDefault()
      openSelect()
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const direction = event.key === 'ArrowDown' ? 1 : -1
      if (!open) {
        const selectedIndex = selectableOptions.findIndex((option) => option.value === value)
        setActiveIndex(selectedIndex >= 0 ? selectedIndex : direction > 0 ? 0 : Math.max(0, selectableOptions.length - 1))
        setOpen(true)
      } else {
        setActiveIndex((current) => moveAssignmentFilterOptionIndex(current, selectableOptions.length, direction))
      }
      return
    }
    if (
      !open
      && searchable
      && event.key.length === 1
      && event.key.trim()
      && !event.altKey
      && !event.ctrlKey
      && !event.metaKey
    ) {
      event.preventDefault()
      updateQuery(event.key)
      setActiveIndex(0)
      setOpen(true)
      return
    }
    const targetIsTextInput = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement
    if (open && (event.key === 'Enter' || (event.key === ' ' && !targetIsTextInput))) {
      event.preventDefault()
      const option = selectableOptions[activeIndex]
      if (option) chooseOption(option.value)
      return
    }
    if (allowClear && !open && value && (event.key === 'Backspace' || event.key === 'Delete')) {
      event.preventDefault()
      onChange('')
    }
  }

  useEffect(() => {
    if (!open) return
    const handleOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', handleOutside)
    return () => document.removeEventListener('pointerdown', handleOutside)
  }, [open])

  useEffect(() => {
    if (!open) {
      setQuery('')
      setAppliedQuery('')
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    setActiveIndex((current) => Math.min(current, Math.max(0, filtered.length - 1)))
  }, [filtered.length, open])

  useEffect(() => {
    if (!open) return
    const list = listRef.current
    const option = list?.children[activeIndex]
    if (!list || !(option instanceof HTMLElement)) return
    if (option.offsetTop < list.scrollTop) list.scrollTop = option.offsetTop
    else if (option.offsetTop + option.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = option.offsetTop + option.offsetHeight - list.clientHeight
  }, [activeIndex, open, filtered.length])

  return (
    <div
      ref={rootRef}
      className={`fa-select${open ? ' is-open' : ''}${disabled ? ' is-disabled' : ''}${selected ? ' has-value' : ''}${className ? ` ${className}` : ''}`}
      data-testid={testId}
      onKeyDown={handleKeyDown}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false)
      }}
    >
      <div
        ref={triggerRef}
        role="combobox"
        className="fa-select-trigger"
        tabIndex={disabled ? -1 : 0}
        aria-haspopup="listbox"
        aria-controls={listboxId}
        aria-expanded={open}
        aria-activedescendant={activeOptionId}
        aria-disabled={disabled}
        aria-autocomplete="none"
        aria-label={accessibleName}
        onClick={() => {
          if (disabled) return
          if (open && !searchable) setOpen(false)
          else if (!open) openSelect()
        }}
      >
        {open && searchable ? (
          <input
            autoFocus
            className={`fa-select-inline-input${selected && !query ? ' has-selected-placeholder' : ''}`}
            value={query}
            placeholder={selected?.label || placeholder}
            aria-label={accessibleName}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => updateQuery(event.target.value, (event.nativeEvent as InputEvent).isComposing)}
            onCompositionEnd={(event) => updateQuery(event.currentTarget.value)}
          />
        ) : <span className={selected ? '' : 'is-placeholder'}>{selected?.label || placeholder}</span>}
        {loading ? <AppIcon name="loader" className="fa-select-icon animate-spin" /> : (
          <span className="fa-select-suffix">
            {allowClear && selected && !open ? (
              <button
                type="button"
                className="fa-select-clear"
                aria-label={`清除${filterName}筛选`}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation()
                  onChange('')
                  updateQuery('')
                  triggerRef.current?.focus()
                }}
              >
                <AppIcon name="close" />
              </button>
            ) : null}
            <AppIcon name="chevronDown" className="fa-select-icon fa-select-chevron" />
          </span>
        )}
      </div>
      {open ? (
        <div className="fa-select-popover">
          <div id={listboxId} ref={listRef} className="fa-select-options" role="listbox">
            {filtered.map((option, index) => (
              <button
                type="button"
                role="option"
                id={`${listboxId}-option-${index}`}
                aria-selected={option.value === value}
                className={`fa-select-option${option.value === value ? ' is-selected' : ''}${activeIndex === index ? ' is-active' : ''}`}
                key={option.value}
                onClick={() => chooseOption(option.value)}
              >
                <span title={option.label}>{option.label}</span>
                {option.value === value ? <AppIcon name="check" className="h-3.5 w-3.5" /> : null}
              </button>
            ))}
            {filtered.length === 0 ? <div className="fa-select-empty">{appliedQuery.trim() ? `没有匹配“${appliedQuery.trim()}”的选项` : emptyText}</div> : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}
