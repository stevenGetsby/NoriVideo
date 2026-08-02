'use client'

import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { AppIcon } from '@/components/ui/icons'
import {
  ASSIGNMENT_STAGE_LABELS,
  ASSIGNMENT_STATUS_META,
  assignmentDrawerAssigneeLabel,
  assignmentNavigateLabel,
  assignmentNavigationBlockReason,
  assignmentReviewNote,
  assignmentTaskLabel,
  formatAssignmentDate,
  moveAssignmentFilterOptionIndex,
  shouldDeferAssignmentFilterActivationToNestedButton,
  type AssignmentStatus,
  type AssignmentTab,
  type CollaborationAssignment,
  type VideoReviewAnnotationDraft,
} from './assignments-view-model'
import { FosVideoReviewEditor } from './FosVideoReviewEditor'

export interface AssignmentSelectOption {
  value: string
  label: string
}

export type AssignmentReviewMode = 'approve' | 'reject' | 'inspect'

const DIALOG_FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function dialogFocusableElements(dialog: HTMLElement): HTMLElement[] {
  return Array.from(dialog.querySelectorAll<HTMLElement>(DIALOG_FOCUSABLE_SELECTOR)).filter((element) => (
    element.getAttribute('aria-hidden') !== 'true'
    && !element.hidden
    && (element.offsetWidth > 0 || element.offsetHeight > 0 || element.getClientRects().length > 0)
  ))
}

/**
 * Keep focus inside a mounted dialog and return it to the control that opened
 * the dialog. Each task dialog is mutually exclusive, so a local trap is
 * sufficient and avoids a global modal stack.
 */
function useDialogFocusTrap<T extends HTMLElement>() {
  const dialogRef = useRef<T>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    const frame = window.requestAnimationFrame(() => {
      const initialFocus = dialog.querySelector<HTMLElement>('[data-dialog-initial-focus]')
        || dialogFocusableElements(dialog)[0]
        || dialog
      initialFocus.focus()
    })

    return () => {
      window.cancelAnimationFrame(frame)
      if (previouslyFocused?.isConnected) previouslyFocused.focus()
    }
  }, [])

  const trapTabKey = (event: ReactKeyboardEvent<T>) => {
    if (event.key !== 'Tab') return
    const dialog = dialogRef.current
    if (!dialog) return
    const focusable = dialogFocusableElements(dialog)
    if (focusable.length === 0) {
      event.preventDefault()
      dialog.focus()
      return
    }

    const activeIndex = focusable.indexOf(document.activeElement as HTMLElement)
    const firstFocusable = focusable[0]
    const lastFocusable = focusable[focusable.length - 1]
    if (event.shiftKey && (activeIndex <= 0)) {
      event.preventDefault()
      lastFocusable.focus()
    } else if (!event.shiftKey && (activeIndex === -1 || activeIndex === focusable.length - 1)) {
      event.preventDefault()
      firstFocusable.focus()
    }
  }

  return { dialogRef, trapTabKey }
}

export function AssignmentFilterSelect({
  value,
  placeholder,
  options,
  searchable = false,
  disabled = false,
  loading = false,
  testId,
  onChange,
}: {
  value: string
  placeholder: string
  options: AssignmentSelectOption[]
  searchable?: boolean
  disabled?: boolean
  loading?: boolean
  testId?: string
  onChange: (value: string) => void
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLDivElement>(null)
  const listboxId = useId()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const filterName = placeholder.replace(/^全部/, '')
  const selected = options.find((option) => option.value === value)
  const filtered = query.trim()
    ? options.filter((option) => option.label.toLocaleLowerCase('zh-CN').includes(query.trim().toLocaleLowerCase('zh-CN')))
    : options
  const selectableOptions = filtered
  const activeOptionId = open && selectableOptions[activeIndex]
    ? `${listboxId}-option-${activeIndex}`
    : undefined

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
      setQuery(event.key)
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
    if (!open && value && (event.key === 'Backspace' || event.key === 'Delete')) {
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
    if (!open) setQuery('')
  }, [open])

  useEffect(() => {
    if (!open) return
    setActiveIndex((current) => Math.min(current, Math.max(0, filtered.length - 1)))
  }, [filtered.length, open])

  return (
    <div
      ref={rootRef}
      className={`fa-select${open ? ' is-open' : ''}${disabled ? ' is-disabled' : ''}${selected ? ' has-value' : ''}`}
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
        aria-label={`筛选${filterName}`}
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
            aria-label={`筛选${filterName}`}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => setQuery(event.target.value)}
          />
        ) : <span className={selected ? '' : 'is-placeholder'}>{selected?.label || placeholder}</span>}
        {loading ? <AppIcon name="loader" className="fa-select-icon animate-spin" /> : (
          <span className="fa-select-suffix">
            {selected && !open ? (
              <button
                type="button"
                className="fa-select-clear"
                aria-label={`清除${filterName}筛选`}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation()
                  onChange('')
                  setQuery('')
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
          <div id={listboxId} className="fa-select-options" role="listbox">
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
            {filtered.length === 0 ? <div className="fa-select-empty">无数据</div> : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}

export function AssignmentStatusChip({ status, compact = false }: { status: AssignmentStatus; compact?: boolean }) {
  const meta = ASSIGNMENT_STATUS_META[status] ?? { label: status, tone: 'unassigned' }
  return <span className={`fa-status-chip status-${meta.tone}${compact ? ' is-compact' : ''}`}>{meta.label}</span>
}

export function AssignmentReviewNote({ assignment }: { assignment: CollaborationAssignment }) {
  const note = assignmentReviewNote(assignment)
  if (!note) return null
  const preview = note.length > 24 ? `${note.slice(0, 24)}…` : note
  return (
    <span className={`fa-review-note ${assignment.status === 'rejected' ? 'is-rejected' : 'is-approved'}`} title={note}>
      {preview}
    </span>
  )
}

export function AssignmentDetailDrawer({
  assignment,
  tab,
  onClose,
  onNavigate,
}: {
  assignment: CollaborationAssignment
  tab: AssignmentTab
  onClose: () => void
  onNavigate: (assignment: CollaborationAssignment) => void
}) {
  const note = assignmentReviewNote(assignment)
  const blocked = assignmentNavigationBlockReason(assignment)
  const { dialogRef, trapTabKey } = useDialogFocusTrap<HTMLElement>()
  return (
    <div className="fa-overlay fa-drawer-overlay" role="presentation" onMouseDown={onClose}>
      <aside
        ref={dialogRef}
        className="fa-task-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="fa-task-drawer-title"
        tabIndex={-1}
        onKeyDown={trapTabKey}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="fa-drawer-head">
          <h2 id="fa-task-drawer-title">任务详情</h2>
          <button type="button" className="fa-dialog-close" aria-label="关闭任务详情" data-dialog-initial-focus onClick={onClose}>
            <AppIcon name="close" className="h-4 w-4" />
          </button>
        </header>
        <div className="fa-drawer-body">
          <dl className="fa-meta-list">
            <div><dt>任务</dt><dd>{assignmentTaskLabel(assignment)}</dd></div>
            <div><dt>阶段</dt><dd>{ASSIGNMENT_STAGE_LABELS[assignment.stage]}</dd></div>
            <div><dt>状态</dt><dd><AssignmentStatusChip status={assignment.status} compact /></dd></div>
            <div><dt>执行人</dt><dd>{assignmentDrawerAssigneeLabel(assignment)}</dd></div>
            <div><dt>所属项目</dt><dd>{assignment.projectName || assignment.projectId || '—'}</dd></div>
            {assignment.stage !== 'asset' && assignment.episodeNumber != null ? <div><dt>关联集</dt><dd>第 {assignment.episodeNumber} 集</dd></div> : null}
            {assignment.assignedAt ? <div><dt>分配时间</dt><dd>{formatAssignmentDate(assignment.assignedAt)}</dd></div> : null}
            {assignment.submittedAt ? <div><dt>提交时间</dt><dd>{formatAssignmentDate(assignment.submittedAt)}</dd></div> : null}
            {assignment.completedAt ? <div><dt>完成时间</dt><dd>{formatAssignmentDate(assignment.completedAt)}</dd></div> : null}
            <div><dt>更新时间</dt><dd>{formatAssignmentDate(assignment.updatedAt)}</dd></div>
            {note ? <div><dt>备注</dt><dd><AssignmentReviewNote assignment={assignment} /></dd></div> : null}
          </dl>
          <footer className="fa-drawer-foot">
            <button
              type="button"
              className="fa-action-button is-primary"
              disabled={Boolean(blocked)}
              title={blocked}
              onClick={() => { onClose(); onNavigate(assignment) }}
            >
              {assignmentNavigateLabel(assignment)}
            </button>
            <span className="sr-only">返回标签：{tab}</span>
          </footer>
        </div>
      </aside>
    </div>
  )
}

export function AssignmentReviewDialog({
  assignment,
  mode,
  busy,
  onClose,
  onConfirm,
}: {
  assignment: CollaborationAssignment
  mode: AssignmentReviewMode
  busy: boolean
  onClose: () => void
  onConfirm: (action: 'approve' | 'reject', note: string, videoAnnotations?: VideoReviewAnnotationDraft[]) => void
}) {
  const [note, setNote] = useState('')
  const [videoAnnotations, setVideoAnnotations] = useState<VideoReviewAnnotationDraft[]>([])
  const approving = mode === 'approve'
  const inspecting = mode === 'inspect'
  const videoReview = assignment.stage === 'video'
  const canReject = Boolean(note.trim()) || (videoReview && videoAnnotations.length > 0)
  const { dialogRef, trapTabKey } = useDialogFocusTrap<HTMLElement>()
  return (
    <div className="fa-overlay" role="presentation" onMouseDown={() => { if (!busy) onClose() }}>
      <section
        ref={dialogRef}
        className={`fa-review-dialog${videoReview ? ' is-video-review' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="fa-review-dialog-title"
        tabIndex={-1}
        onKeyDown={trapTabKey}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="fa-review-head">
          <h2 id="fa-review-dialog-title">{inspecting ? '视频审核与时段标注' : approving ? '通过任务' : '驳回任务'}</h2>
          <button type="button" className="fa-dialog-close" aria-label="关闭审核弹窗" disabled={busy} onClick={onClose}>
            <AppIcon name="close" className="h-4 w-4" />
          </button>
        </header>
        <div className="fa-review-body">
          {videoReview ? (
            <FosVideoReviewEditor
              assignment={assignment}
              value={videoAnnotations}
              onChange={setVideoAnnotations}
              readOnly={approving}
            />
          ) : null}
          <label htmlFor="fa-review-note">
            {approving
              ? '通过意见（选填）'
              : videoReview
                ? '总体修改意见（可选；也可仅添加时段标注）'
                : '修改意见（必填）'}
          </label>
          <div className="fa-review-textarea-wrap">
            <textarea
              id="fa-review-note"
              data-dialog-initial-focus
              rows={3}
              maxLength={500}
              value={note}
              placeholder={approving ? '可填写审核意见…' : '请说明需要修改的内容，负责人会在业务 Panel 中看到；视频任务也可以只添加上方时段标注…'}
              onChange={(event) => setNote(event.target.value)}
            />
            <span>{note.length} / 500</span>
          </div>
        </div>
        <footer className="fa-review-foot">
          <button type="button" className="fa-action-button" disabled={busy} onClick={onClose}>取消</button>
          {inspecting ? (
            <>
              <button
                type="button"
                className="fa-action-button is-danger"
                disabled={busy || !canReject}
                onClick={() => onConfirm('reject', note.trim(), videoAnnotations)}
              >
                {busy ? <AppIcon name="loader" className="h-3.5 w-3.5 animate-spin" /> : null}
                驳回并提交意见
              </button>
              <button
                type="button"
                className="fa-action-button is-success"
                disabled={busy}
                onClick={() => onConfirm('approve', note.trim())}
              >
                {busy ? <AppIcon name="loader" className="h-3.5 w-3.5 animate-spin" /> : null}
                确认通过
              </button>
            </>
          ) : (
            <button
              type="button"
              className={`fa-action-button ${approving ? 'is-success' : 'is-danger'}`}
              disabled={busy || (!approving && !canReject)}
              onClick={() => onConfirm(approving ? 'approve' : 'reject', note.trim(), videoReview && !approving ? videoAnnotations : undefined)}
            >
              {busy ? <AppIcon name="loader" className="h-3.5 w-3.5 animate-spin" /> : null}
              {approving ? '确认通过' : '确认驳回'}
            </button>
          )}
        </footer>
        <span className="sr-only">正在审核 {assignmentTaskLabel(assignment)}</span>
      </section>
    </div>
  )
}
