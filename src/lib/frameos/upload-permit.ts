/**
 * A bounded FIFO permit pool for memory-heavy work (video normalization,
 * Sharp, multipart buffering).
 *
 * The previous implementation rejected the third concurrent upload outright.
 * Any transient burst — two canvas tabs, a panorama and a storyboard upload
 * firing together, or a 200MB video that keeps its permit for minutes — turned
 * into a visible “偶发失败”. Waiting for a short, bounded interval absorbs the
 * burst while `maxQueue` still caps how many requests may pile up.
 */

export class UploadPermitTimeoutError extends Error {
  readonly waitMs: number

  constructor(waitMs: number) {
    super(`Timed out after ${waitMs}ms waiting for an upload permit`)
    this.name = 'UploadPermitTimeoutError'
    this.waitMs = waitMs
  }
}

export class UploadPermitOverflowError extends Error {
  readonly maxQueue: number

  constructor(maxQueue: number) {
    super(`Upload permit queue is full (${maxQueue})`)
    this.name = 'UploadPermitOverflowError'
    this.maxQueue = maxQueue
  }
}

export class UploadPermitAbortError extends Error {
  constructor() {
    super('The upload was aborted while waiting for a permit')
    this.name = 'AbortError'
  }
}

interface PermitWaiter {
  resolve: () => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout> | null
  signal?: AbortSignal
  onAbort?: () => void
}

export interface UploadPermitOptions {
  limit: number
  waitMs: number
  maxQueue?: number
}

export interface UploadPermitRunOptions {
  signal?: AbortSignal
}

export class UploadPermitPool {
  private readonly limit: number
  private readonly waitMs: number
  private readonly maxQueue: number
  private active = 0
  private readonly queue: PermitWaiter[] = []

  constructor({ limit, waitMs, maxQueue = 8 }: UploadPermitOptions) {
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new RangeError('UploadPermitPool limit must be a positive integer')
    }
    if (!Number.isFinite(waitMs) || waitMs < 0) {
      throw new RangeError('UploadPermitPool waitMs must be a non-negative number')
    }
    if (!Number.isInteger(maxQueue) || maxQueue < 0) {
      throw new RangeError('UploadPermitPool maxQueue must be a non-negative integer')
    }
    this.limit = limit
    this.waitMs = Math.trunc(waitMs)
    this.maxQueue = maxQueue
  }

  get activeCount(): number {
    return this.active
  }

  get queuedCount(): number {
    return this.queue.length
  }

  /** Acquires a permit, waiting in FIFO order until one is released. */
  async run<T>(task: () => Promise<T>, options: UploadPermitRunOptions = {}): Promise<T> {
    await this.acquire(options.signal)
    try {
      if (options.signal?.aborted) throw new UploadPermitAbortError()
      return await task()
    } finally {
      this.release()
    }
  }

  private acquire(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(new UploadPermitAbortError())
    // Direct acquisition is only allowed when nobody is already waiting, so a
    // burst keeps strict FIFO order instead of letting new arrivals jump ahead.
    if (this.active < this.limit && this.queue.length === 0) {
      this.active += 1
      return Promise.resolve()
    }
    if (this.queue.length >= this.maxQueue) {
      return Promise.reject(new UploadPermitOverflowError(this.maxQueue))
    }

    return new Promise<void>((resolve, reject) => {
      const waiter: PermitWaiter = {
        resolve,
        reject,
        timer: null,
        signal,
        onAbort: undefined,
      }

      waiter.timer = setTimeout(() => {
        if (this.remove(waiter)) reject(new UploadPermitTimeoutError(this.waitMs))
      }, this.waitMs)
      // Do not keep the Node event loop alive just because a queue timer is
      // pending; the request itself holds the process open.
      waiter.timer.unref?.()

      if (signal) {
        waiter.onAbort = () => {
          if (this.remove(waiter)) reject(new UploadPermitAbortError())
        }
        signal.addEventListener('abort', waiter.onAbort, { once: true })
      }

      this.queue.push(waiter)
    })
  }

  /**
   * Removes a waiter that has not been granted a permit yet. Returns false when
   * the waiter was already resolved/rejected so timeout and abort cannot both
   * settle the same promise.
   */
  private remove(waiter: PermitWaiter): boolean {
    const index = this.queue.indexOf(waiter)
    if (index < 0) return false
    this.queue.splice(index, 1)
    this.clearWaiter(waiter)
    return true
  }

  private clearWaiter(waiter: PermitWaiter): void {
    if (waiter.timer !== null) {
      clearTimeout(waiter.timer)
      waiter.timer = null
    }
    if (waiter.signal && waiter.onAbort) {
      waiter.signal.removeEventListener('abort', waiter.onAbort)
      waiter.onAbort = undefined
    }
  }

  private release(): void {
    if (this.active <= 0) return
    this.active -= 1
    this.drain()
  }

  private drain(): void {
    while (this.active < this.limit && this.queue.length > 0) {
      const waiter = this.queue.shift()
      if (!waiter) return
      this.clearWaiter(waiter)
      this.active += 1
      waiter.resolve()
    }
  }
}
