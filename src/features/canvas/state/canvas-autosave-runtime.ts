import type { CanvasOfflineDraft } from './canvas-offline-store'

export const CANVAS_AUTOSAVE_RETRY_DELAYS_MS = [3_000, 8_000, 20_000, 45_000, 60_000] as const

type TimerHandle = ReturnType<typeof setTimeout>
type ScheduleTimer = (callback: () => void, delayMs: number) => TimerHandle
type CancelTimer = (handle: TimerHandle) => void

export function canvasAutosaveRetryDelay(failureCount: number): number {
  const index = Math.max(0, Math.min(CANVAS_AUTOSAVE_RETRY_DELAYS_MS.length - 1, Math.floor(failureCount) || 0))
  return CANVAS_AUTOSAVE_RETRY_DELAYS_MS[index]
}

export function createCanvasAutosaveRetryController({
  run,
  scheduleTimer = (callback, delayMs) => setTimeout(callback, delayMs),
  cancelTimer = (handle) => clearTimeout(handle),
}: {
  run: () => void | Promise<void>
  scheduleTimer?: ScheduleTimer
  cancelTimer?: CancelTimer
}) {
  let timer: TimerHandle | null = null
  let failureCount = 0
  let disposed = false

  const cancelPending = () => {
    if (timer === null) return
    cancelTimer(timer)
    timer = null
  }

  return {
    scheduleAfterFailure() {
      if (disposed) return null
      cancelPending()
      const delayMs = canvasAutosaveRetryDelay(failureCount)
      failureCount += 1
      timer = scheduleTimer(() => {
        timer = null
        if (!disposed) void Promise.resolve(run()).catch(() => undefined)
      }, delayMs)
      return delayMs
    },
    reconnect() {
      if (disposed) return false
      cancelPending()
      void Promise.resolve(run()).catch(() => undefined)
      return true
    },
    reset() {
      failureCount = 0
      cancelPending()
    },
    dispose() {
      disposed = true
      cancelPending()
    },
    failureCount: () => failureCount,
    hasPending: () => timer !== null,
  }
}

export function createCanvasOfflineDraftBuffer({
  read,
  write,
  remove,
  delayMs = 80,
  scheduleTimer = (callback, delay) => setTimeout(callback, delay),
  cancelTimer = (handle) => clearTimeout(handle),
}: {
  read: () => CanvasOfflineDraft | null
  write: (draft: CanvasOfflineDraft) => Promise<void>
  remove: () => Promise<void>
  delayMs?: number
  scheduleTimer?: ScheduleTimer
  cancelTimer?: CancelTimer
}) {
  let timer: TimerHandle | null = null
  let disposed = false
  let queue = Promise.resolve()

  const cancelPending = () => {
    if (timer === null) return
    cancelTimer(timer)
    timer = null
  }

  const enqueue = (operation: () => Promise<void>) => {
    const next = queue.catch(() => undefined).then(operation)
    queue = next
    return next
  }

  const flush = () => {
    cancelPending()
    const draft = read()
    return draft ? enqueue(async () => await write(draft)) : queue
  }

  return {
    schedule() {
      if (disposed) return
      cancelPending()
      timer = scheduleTimer(() => {
        timer = null
        void flush().catch(() => undefined)
      }, delayMs)
    },
    flush,
    clear() {
      cancelPending()
      return enqueue(remove)
    },
    dispose({ flush: shouldFlush = true }: { flush?: boolean } = {}) {
      disposed = true
      cancelPending()
      return shouldFlush ? flush() : queue
    },
    hasPending: () => timer !== null,
  }
}
