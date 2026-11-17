type PrivacyResolve = (result: { event: 'agree' | 'disagree'; buttonId?: string }) => void

let pending: PrivacyResolve | null = null
const listeners = new Set<(show: boolean) => void>()

function emit(show: boolean): void {
  listeners.forEach((fn) => fn(show))
}

export function setupPrivacy(): void {
  if (typeof wx.onNeedPrivacyAuthorization !== 'function') return
  wx.onNeedPrivacyAuthorization((resolve) => {
    // 社区 typings 把首个回调参数误标为 GeneralCallbackResult，实际是 resolve 函数。
    pending = resolve as unknown as PrivacyResolve
    emit(true)
  })
}

export function onPrivacyPrompt(fn: (show: boolean) => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

export function resolvePrivacy(event: 'agree' | 'disagree', buttonId?: string): void {
  if (pending) {
    pending(buttonId ? { event, buttonId } : { event })
    pending = null
  }
  emit(false)
}

export function openPrivacyContract(): void {
  if (typeof wx.openPrivacyContract === 'function') wx.openPrivacyContract({})
}
