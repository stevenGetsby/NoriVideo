'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import { registerConfirmHandler, type ConfirmRequest } from '@/lib/ui/feedback'

export function ConfirmHost() {
  const t = useTranslations('common')
  const [queue, setQueue] = useState<ConfirmRequest[]>([])
  const current = queue[0]
  const confirmRef = useRef<HTMLButtonElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const messageId = useId()

  useEffect(() => registerConfirmHandler((request) => setQueue((items) => [...items, request])), [])

  const settle = useCallback((confirmed: boolean) => {
    if (!current) return
    current.resolve(confirmed)
    setQueue((items) => items.slice(1))
  }, [current])

  useEffect(() => {
    if (!current) return
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    // Destructive prompts start on 取消 so a stray Enter cannot delete anything.
    ;(current.danger ? cancelRef : confirmRef).current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      settle(false)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      previousFocus?.focus()
    }
  }, [current, settle])

  if (!current || typeof document === 'undefined') return null

  return createPortal(
    <div className="fos-viewport-theme">
      <div
        className="fos-overlay nori-confirm-overlay"
        role="presentation"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) settle(false)
        }}
      >
        <section
          className="fos-dialog nori-confirm"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby={current.title ? titleId : undefined}
          aria-describedby={messageId}
        >
          <div className="nori-confirm-body">
            <span className={`nori-confirm-icon${current.danger ? ' is-danger' : ''}`}>
              <AppIcon name={current.danger ? 'alert' : 'infoCircle'} />
            </span>
            <div className="nori-confirm-copy">
              {current.title ? <h2 id={titleId} className="fos-dialog-title">{current.title}</h2> : null}
              <p id={messageId}>{current.message}</p>
            </div>
          </div>
          <footer className="fos-dialog-foot">
            <button ref={cancelRef} type="button" className="fos-btn fos-btn-ghost" onClick={() => settle(false)}>
              {current.cancelLabel || t('cancel')}
            </button>
            <button
              ref={confirmRef}
              type="button"
              className={`fos-btn ${current.danger ? 'works-danger-btn' : 'fos-btn-primary'}`}
              onClick={() => settle(true)}
            >
              {current.confirmLabel || t('confirm')}
            </button>
          </footer>
        </section>
      </div>
    </div>,
    document.body,
  )
}
