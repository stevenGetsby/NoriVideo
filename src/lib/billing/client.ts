export const BALANCE_CHANGED_EVENT = 'nori:balance-changed'
const BALANCE_CHANGED_CHANNEL = 'nori:balance-updates'
const BALANCE_CHANGED_STORAGE_KEY = 'nori.balance-update'
const BALANCE_SENDER = `${Date.now()}:${Math.random()}`

export function subscribeBalanceChanges(listener: () => void) {
  window.addEventListener(BALANCE_CHANGED_EVENT, listener)
  let channel: BroadcastChannel | null = null
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      channel = new BroadcastChannel(BALANCE_CHANGED_CHANNEL)
      channel.onmessage = (event) => {
        if (event.data?.type === 'refresh' && event.data.source !== BALANCE_SENDER) listener()
      }
    }
  } catch { /* Restricted browsers still receive local/focus refreshes. */ }
  const storage = (event: StorageEvent) => {
    if (event.key === BALANCE_CHANGED_STORAGE_KEY) listener()
  }
  window.addEventListener('storage', storage)
  return () => {
    window.removeEventListener(BALANCE_CHANGED_EVENT, listener)
    window.removeEventListener('storage', storage)
    channel?.close()
  }
}

export function createCreditIdempotencyKey(operation: string, targetId: string) {
  const randomPart = typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
  return `credits:${operation}:${targetId}:${randomPart}`.slice(0, 128)
}

export function notifyBalanceChanged() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(BALANCE_CHANGED_EVENT))
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        const channel = new BroadcastChannel(BALANCE_CHANGED_CHANNEL)
        channel.postMessage({ type: 'refresh', source: BALANCE_SENDER })
        channel.close()
      } else {
        window.localStorage.setItem(BALANCE_CHANGED_STORAGE_KEY, `${Date.now()}:${Math.random()}`)
      }
    } catch { /* Updating a limit must succeed even if browser storage is blocked. */ }
  }
}
