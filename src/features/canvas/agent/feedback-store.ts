import type { planBuildGraph } from './commands/build-graph'

type Ghost = ReturnType<typeof planBuildGraph>['blueprint']
function channel<T>(initial: T) {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    get: () => value,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    set(next: T) {
      if (Object.is(next, value)) return
      value = next
      listeners.forEach((listener) => listener())
    },
  }
}

const emptyTouch: ReadonlySet<string> = new Set()
export function createAgentFeedbackStore() {
  const ghost = channel<Ghost | null>(null)
  const touch = channel<ReadonlySet<string>>(emptyTouch)
  const expiry = new Map<string, ReturnType<typeof setTimeout>>()
  return {
    ghost, touch,
    flash(ids: string[]) {
      const current = new Set(touch.get())
      for (const id of ids) {
        current.add(id)
        const previous = expiry.get(id)
        if (previous) clearTimeout(previous)
        expiry.set(id, setTimeout(() => {
          expiry.delete(id)
          const next = new Set(touch.get())
          next.delete(id)
          touch.set(next.size ? next : emptyTouch)
        }, 1200))
      }
      touch.set(current)
    },
    dispose() {
      expiry.forEach(clearTimeout)
      expiry.clear()
      ghost.set(null)
      touch.set(emptyTouch)
    },
  }
}

export type AgentFeedbackStore = ReturnType<typeof createAgentFeedbackStore>
