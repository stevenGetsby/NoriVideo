'use client'

import { useCallback, useEffect, useRef, type MouseEvent } from 'react'
import { confirmAction } from '@/lib/ui/feedback'

const openDialogs: symbol[] = []

interface DismissableDialogOptions {
  onClose: () => void
  dirty?: boolean
  busy?: boolean
}

// Esc and backdrop clicks only dismiss the top-most dialog, and ask before discarding typed input.
export function useDismissableDialog({ onClose, dirty = false, busy = false }: DismissableDialogOptions) {
  const latest = useRef({ onClose, dirty, busy })
  useEffect(() => {
    latest.current = { onClose, dirty, busy }
  })

  const requestClose = useCallback(async () => {
    if (latest.current.busy) return
    if (latest.current.dirty && !await confirmAction({
      title: '放弃已填写的内容？',
      message: '关闭后这次填写的内容不会保留。',
      confirmLabel: '放弃',
      cancelLabel: '继续编辑',
      danger: true,
    })) return
    latest.current.onClose()
  }, [])

  useEffect(() => {
    const id = Symbol('dialog')
    openDialogs.push(id)
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || openDialogs[openDialogs.length - 1] !== id) return
      event.preventDefault()
      void requestClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      openDialogs.splice(openDialogs.indexOf(id), 1)
    }
  }, [requestClose])

  const onBackdropMouseDown = useCallback((event: MouseEvent) => {
    if (event.target === event.currentTarget) void requestClose()
  }, [requestClose])

  return { requestClose, onBackdropMouseDown }
}
