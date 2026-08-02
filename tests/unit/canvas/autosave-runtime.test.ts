import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CANVAS_AUTOSAVE_RETRY_DELAYS_MS,
  canvasAutosaveRetryDelay,
  createCanvasAutosaveRetryController,
  createCanvasOfflineDraftBuffer,
} from '@/features/canvas/state/canvas-autosave-runtime'
import {
  createCanvasOfflineDraft,
  type CanvasOfflineDraft,
} from '@/features/canvas/state/canvas-offline-store'

function draft(text: string): CanvasOfflineDraft {
  return createCanvasOfflineDraft({
    namespace: { accountId: 'account-1', projectId: 'project-1', canvasId: 'canvas-1' },
    document: {
      expectedRevision: 3,
      clientId: 'tab-1',
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [{
        id: 'node-1',
        canvasId: 'canvas-1',
        type: 'note',
        position: { x: 0, y: 0 },
        size: null,
        data: { text },
        status: 'IDLE',
        taskId: null,
        runId: null,
        mediaObjectId: null,
        parentNodeId: null,
      }],
      edges: [],
    },
  })
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('canvas autosave retry controller', () => {
  it('uses 3/8/20/45/60 second backoff and caps later attempts at 60 seconds', async () => {
    vi.useFakeTimers()
    const run = vi.fn(async () => undefined)
    const controller = createCanvasAutosaveRetryController({ run })
    const expected = [...CANVAS_AUTOSAVE_RETRY_DELAYS_MS, 60_000, 60_000]

    for (const [index, delay] of expected.entries()) {
      expect(canvasAutosaveRetryDelay(index)).toBe(delay)
      expect(controller.scheduleAfterFailure()).toBe(delay)
      await vi.advanceTimersByTimeAsync(delay - 1)
      expect(run).toHaveBeenCalledTimes(index)
      await vi.advanceTimersByTimeAsync(1)
      expect(run).toHaveBeenCalledTimes(index + 1)
    }

    expect(controller.failureCount()).toBe(expected.length)
  })

  it('runs immediately on reconnect and cancels the pending backoff', async () => {
    vi.useFakeTimers()
    const run = vi.fn(async () => undefined)
    const controller = createCanvasAutosaveRetryController({ run })

    controller.scheduleAfterFailure()
    expect(controller.hasPending()).toBe(true)
    expect(controller.reconnect()).toBe(true)
    expect(controller.hasPending()).toBe(false)
    expect(run).toHaveBeenCalledOnce()

    await vi.advanceTimersByTimeAsync(3_000)
    expect(run).toHaveBeenCalledOnce()
  })

  it('cancels timers on dispose and contains rejected retry promises', async () => {
    vi.useFakeTimers()
    const run = vi.fn(async () => { throw new Error('still offline') })
    const controller = createCanvasAutosaveRetryController({ run })

    controller.scheduleAfterFailure()
    await vi.advanceTimersByTimeAsync(3_000)
    expect(run).toHaveBeenCalledOnce()

    controller.scheduleAfterFailure()
    controller.dispose()
    await vi.advanceTimersByTimeAsync(8_000)
    expect(run).toHaveBeenCalledOnce()
    expect(controller.reconnect()).toBe(false)
  })
})

describe('canvas offline draft buffer', () => {
  it('flushes the latest draft during dispose even before its debounce timer fires', async () => {
    vi.useFakeTimers()
    let current = draft('第一版')
    const written: CanvasOfflineDraft[] = []
    const write = vi.fn(async (value: CanvasOfflineDraft) => { written.push(value) })
    const buffer = createCanvasOfflineDraftBuffer({
      read: () => current,
      write,
      remove: async () => undefined,
    })

    buffer.schedule()
    current = draft('卸载前最新一版')
    await buffer.dispose()

    expect(write).toHaveBeenCalledOnce()
    expect(written[0]?.document.nodes[0]?.data?.text).toBe('卸载前最新一版')
    await vi.advanceTimersByTimeAsync(80)
    expect(write).toHaveBeenCalledOnce()
  })

  it('serializes clear after an in-flight put so stale data cannot win the race', async () => {
    const events: string[] = []
    let releaseWrite!: () => void
    const writeGate = new Promise<void>((resolve) => { releaseWrite = resolve })
    const buffer = createCanvasOfflineDraftBuffer({
      read: () => draft('待删除'),
      write: async () => {
        events.push('put:start')
        await writeGate
        events.push('put:end')
      },
      remove: async () => { events.push('delete') },
    })

    const putting = buffer.flush()
    await Promise.resolve()
    const clearing = buffer.clear()
    releaseWrite()
    await Promise.all([putting, clearing])

    expect(events).toEqual(['put:start', 'put:end', 'delete'])
  })

  it('can dispose without flushing and prevents later scheduling', async () => {
    vi.useFakeTimers()
    const write = vi.fn(async () => undefined)
    const buffer = createCanvasOfflineDraftBuffer({
      read: () => draft('不应写入'),
      write,
      remove: async () => undefined,
    })

    buffer.schedule()
    await buffer.dispose({ flush: false })
    buffer.schedule()
    await vi.advanceTimersByTimeAsync(200)

    expect(write).not.toHaveBeenCalled()
    expect(buffer.hasPending()).toBe(false)
  })
})
