export type NoticeTone = 'success' | 'error' | 'warning' | 'info'

export interface ConfirmOptions {
  title?: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}

export interface ConfirmRequest extends ConfirmOptions {
  resolve: (confirmed: boolean) => void
}

let noticeHandler: ((message: string, tone: NoticeTone) => void) | null = null
let confirmHandler: ((request: ConfirmRequest) => void) | null = null

export function registerNoticeHandler(handler: typeof noticeHandler) {
  noticeHandler = handler
  return () => {
    if (noticeHandler === handler) noticeHandler = null
  }
}

export function registerConfirmHandler(handler: typeof confirmHandler) {
  confirmHandler = handler
  return () => {
    if (confirmHandler === handler) confirmHandler = null
  }
}

// Without a mounted host (isolated tests, error boundaries) fall back to the native dialogs.
export function notify(message: string, tone: NoticeTone = 'error') {
  if (noticeHandler) noticeHandler(message, tone)
  else if (typeof window !== 'undefined') window.alert(message)
}

export function confirmAction(options: ConfirmOptions | string): Promise<boolean> {
  const request = typeof options === 'string' ? { message: options } : options
  if (confirmHandler) {
    const handler = confirmHandler
    return new Promise((resolve) => handler({ ...request, resolve }))
  }
  return Promise.resolve(typeof window !== 'undefined' && window.confirm(request.message))
}
