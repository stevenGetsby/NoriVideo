import { useEffect, useRef } from 'react'

export function useDialogDismiss(open: boolean, onClose: () => void, enabled = true) {
  const closeRef = useRef(onClose)
  const enabledRef = useRef(enabled)
  closeRef.current = onClose
  enabledRef.current = enabled
  useEffect(() => {
    if (!open) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const dismiss = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !enabledRef.current) return
      event.preventDefault()
      event.stopPropagation()
      closeRef.current()
    }
    document.addEventListener('keydown', dismiss, true)
    return () => {
      document.removeEventListener('keydown', dismiss, true)
      previous?.focus()
    }
  }, [open])
}
