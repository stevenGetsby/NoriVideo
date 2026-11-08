import { describe, expect, it, vi } from 'vitest'
import {
  UploadPermitAbortError,
  UploadPermitOverflowError,
  UploadPermitPool,
  UploadPermitTimeoutError,
} from '@/lib/frameos/upload-permit'

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('UploadPermitPool', () => {
  it('never runs more tasks than the limit and queues the rest in FIFO order', async () => {
    const pool = new UploadPermitPool({ limit: 2, waitMs: 5000 })
    const order: string[] = []
    const first = deferred()
    const second = deferred()
    const third = deferred()

    const running = [
      pool.run(async () => {
        order.push('a')
        await first.promise
        return 'a'
      }),
      pool.run(async () => {
        order.push('b')
        await second.promise
        return 'b'
      }),
      pool.run(async () => {
        order.push('c')
        await third.promise
        return 'c'
      }),
      pool.run(async () => {
        order.push('d')
        return 'd'
      }),
    ]

    await vi.waitFor(() => expect(pool.activeCount).toBe(2))
    expect(pool.queuedCount).toBe(2)
    expect(order).toEqual(['a', 'b'])

    first.resolve()
    await vi.waitFor(() => expect(order).toEqual(['a', 'b', 'c']))
    expect(pool.activeCount).toBe(2)

    third.resolve()
    await vi.waitFor(() => expect(order).toEqual(['a', 'b', 'c', 'd']))
    second.resolve()
    await expect(Promise.all(running)).resolves.toEqual(['a', 'b', 'c', 'd'])
    expect(pool.activeCount).toBe(0)
    expect(pool.queuedCount).toBe(0)
  })

  it('does not let a new arrival jump ahead of waiting FIFO entries', async () => {
    const pool = new UploadPermitPool({ limit: 1, waitMs: 5000 })
    const gate = deferred()
    const order: string[] = []
    const holder = pool.run(async () => {
      await gate.promise
    })
    const queuedA = pool.run(async () => {
      order.push('a')
    })
    const queuedB = pool.run(async () => {
      order.push('b')
    })
    const late = pool.run(async () => {
      order.push('c')
    })

    await vi.waitFor(() => expect(pool.queuedCount).toBe(3))
    gate.resolve()
    await Promise.all([holder, queuedA, queuedB, late])
    expect(order).toEqual(['a', 'b', 'c'])
  })

  it('releases the permit when the task rejects and keeps the pool usable', async () => {
    const pool = new UploadPermitPool({ limit: 1, waitMs: 5000 })
    await expect(pool.run(async () => {
      throw new Error('normalization failed')
    })).rejects.toThrow('normalization failed')

    expect(pool.activeCount).toBe(0)
    await expect(pool.run(async () => 'ok')).resolves.toBe('ok')
    expect(pool.activeCount).toBe(0)
  })

  it('times out a queued waiter without leaking the permit or blocking the queue', async () => {
    const pool = new UploadPermitPool({ limit: 1, waitMs: 30 })
    const gate = deferred()
    const holder = pool.run(async () => {
      await gate.promise
    })

    await expect(pool.run(async () => 'never')).rejects.toBeInstanceOf(UploadPermitTimeoutError)
    expect(pool.activeCount).toBe(1)
    expect(pool.queuedCount).toBe(0)

    gate.resolve()
    await holder
    expect(pool.activeCount).toBe(0)
    await expect(pool.run(async () => 'next')).resolves.toBe('next')
  })

  it('rejects immediately with an overflow error once the queue cap is reached', async () => {
    const pool = new UploadPermitPool({ limit: 1, waitMs: 5000, maxQueue: 1 })
    const gate = deferred()
    const holder = pool.run(async () => {
      await gate.promise
    })
    const queued = pool.run(async () => 'queued')

    await vi.waitFor(() => expect(pool.queuedCount).toBe(1))
    await expect(pool.run(async () => 'overflow')).rejects.toBeInstanceOf(UploadPermitOverflowError)
    expect(pool.queuedCount).toBe(1)

    gate.resolve()
    await expect(Promise.all([holder, queued])).resolves.toEqual([undefined, 'queued'])
  })

  it('removes an aborted waiter from the queue and lets later waiters proceed', async () => {
    const pool = new UploadPermitPool({ limit: 1, waitMs: 5000 })
    const gate = deferred()
    const controller = new AbortController()
    const holder = pool.run(async () => {
      await gate.promise
    })
    const aborted = pool.run(async () => 'aborted', { signal: controller.signal })
    const next = pool.run(async () => 'next')

    await vi.waitFor(() => expect(pool.queuedCount).toBe(2))
    controller.abort()
    await expect(aborted).rejects.toBeInstanceOf(UploadPermitAbortError)
    expect(pool.queuedCount).toBe(1)

    gate.resolve()
    await holder
    await expect(next).resolves.toBe('next')
    expect(pool.activeCount).toBe(0)
  })

  it('rejects without acquiring a permit when the signal is already aborted', async () => {
    const pool = new UploadPermitPool({ limit: 1, waitMs: 5000 })
    const controller = new AbortController()
    controller.abort()

    await expect(pool.run(async () => 'noop', { signal: controller.signal }))
      .rejects.toBeInstanceOf(UploadPermitAbortError)
    expect(pool.activeCount).toBe(0)
    expect(pool.queuedCount).toBe(0)
    await expect(pool.run(async () => 'ok')).resolves.toBe('ok')
  })

  it('releases only once per run so activeCount never goes negative', async () => {
    const pool = new UploadPermitPool({ limit: 2, waitMs: 5000 })
    await Promise.all([
      pool.run(async () => 'a'),
      pool.run(async () => 'b'),
      pool.run(async () => 'c'),
    ])
    expect(pool.activeCount).toBe(0)
    expect(pool.queuedCount).toBe(0)

    await pool.run(async () => 'd')
    expect(pool.activeCount).toBe(0)
  })
})
