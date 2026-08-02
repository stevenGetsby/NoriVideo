export const BALANCE_CHANGED_EVENT = 'nori:balance-changed'

export function createCreditIdempotencyKey(operation: string, targetId: string) {
  const randomPart = typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
  return `credits:${operation}:${targetId}:${randomPart}`.slice(0, 128)
}

export function notifyBalanceChanged() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(BALANCE_CHANGED_EVENT))
  }
}
