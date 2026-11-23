import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CANVAS_AUTOSAVE_RETRY_DELAYS_MS,
  canvasAutosaveRetryDelay,
  createCanvasAutosaveRetryController,
  createCanvasOfflineDraftBuffer,
  createCanvasPersistenceHold,
} from '@/features/canvas/state/canvas-autosave-runtime'
import {
  createCanvasGeometryOfflineDraft,
  createCanvasOfflineDraft,
  createMemoryCanvasOfflineDraftStore,
  loadCanvasOfflineDraft,
  saveCanvasOfflineDraft,
  resolveCanvasOfflineRecoveryChoice,
  type CanvasOfflineDraft,
} from '@/features/canvas/state/canvas-offline-store'
import { hydrateCanvasDocumentForWrite } from '@/features/canvas/state/canvas-node-detail-cache'

it('round-trips a small geometry journal and replays it without replacing newer server content', async () => {
  const baseline = draft('confirmed').document
  const node = baseline.nodes[0]!
  const position = { x: 240, y: 80 }
  const edit = createCanvasGeometryOfflineDraft({
    namespace: { accountId: 'account', projectId: 'project', canvasId: 'canvas' },
    base: baseline,
    operations: [{ type: 'node.update_geometry', id: node.id, position }],
  })
  expect(edit).not.toBeNull()
  const store = createMemoryCanvasOfflineDraftStore()
  await saveCanvasOfflineDraft(edit!, store)
  const loaded = await loadCanvasOfflineDraft(edit!.namespace, store)
  expect(loaded?.document.nodes).toEqual([])
  expect(loaded?.document.edges).toEqual([])
  const live = { ...baseline, expectedRevision: 10, nodes: [{ ...node, data: { text: 'newer server text' } }] }
  const recovered = resolveCanvasOfflineRecoveryChoice({
    draft: loaded!, choice: 'local', serverRevision: 10, clientId: 'restoring-tab', currentDocument: live,
  })
  expect(recovered?.nodes).toEqual([{ ...node, position, data: { text: 'newer server text' } }])
  expect(recovered?.expectedRevision).toBe(10)
  expect(() => resolveCanvasOfflineRecoveryChoice({
    draft: loaded!, choice: 'local', serverRevision: 10, clientId: 'restoring-tab', currentDocument: { ...live, nodes: [] },
  })).toThrow(/不存在/)
})

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

  it('waits for asynchronous hydration and writes the latest draft during dispose', async () => {
    let current = draft('水合前')
    let releaseRead!: () => void
    const readGate = new Promise<void>((resolve) => { releaseRead = resolve })
    const written: CanvasOfflineDraft[] = []
    const buffer = createCanvasOfflineDraftBuffer({
      read: async () => {
        await readGate
        return current
      },
      write: async (value) => { written.push(value) },
      remove: async () => undefined,
    })

    buffer.schedule()
    const disposing = buffer.dispose()
    current = draft('水合期间最新编辑')
    releaseRead()
    await disposing

    expect(written.map((value) => value.document.nodes[0]?.data?.text)).toEqual(['水合期间最新编辑'])
  })

  it('hydrates a detached summary before persisting an offline recovery document', async () => {
    const summary = draft('摘要').document
    summary.nodes[0]!.data = { title: '摘要', __canvasUnhydrated: true }
    summary.nodes[0]!.position = { x: 60, y: 90 }
    const namespace = { accountId: 'account-1', projectId: 'project-1', canvasId: 'canvas-1' }
    const store = createMemoryCanvasOfflineDraftStore()
    const buffer = createCanvasOfflineDraftBuffer({
      read: async () => {
        const document = await hydrateCanvasDocumentForWrite(summary, async (node) => ({
          ...draft('完整离线正文').document.nodes[0]!,
          position: node.position,
        }))
        return createCanvasOfflineDraft({ namespace, document, copy: false })
      },
      write: async (value) => await saveCanvasOfflineDraft(value, store),
      remove: async () => undefined,
    })

    buffer.schedule()
    await buffer.dispose()

    const recovered = await loadCanvasOfflineDraft(namespace, store)
    expect(recovered?.document.nodes[0]?.data?.text).toBe('完整离线正文')
    expect(recovered?.document.nodes[0]?.data?.__canvasUnhydrated).toBeUndefined()
    expect(recovered?.document.nodes[0]?.position).toEqual({ x: 60, y: 90 })
    expect(summary.nodes[0]?.data?.__canvasUnhydrated).toBe(true)
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

describe('canvas offline draft buffer cancel', () => {
  it('drops a pending debounce without writing and still allows a later schedule', async () => {
    vi.useFakeTimers()
    const write = vi.fn(async () => undefined)
    const buffer = createCanvasOfflineDraftBuffer({
      read: () => draft('稍后'),
      write,
      remove: async () => undefined,
    })

    buffer.schedule()
    buffer.cancel()
    await vi.advanceTimersByTimeAsync(200)
    expect(write).not.toHaveBeenCalled()
    expect(buffer.hasPending()).toBe(false)

    buffer.schedule()
    await vi.advanceTimersByTimeAsync(80)
    expect(write).toHaveBeenCalledOnce()
  })
})

describe('canvas persistence hold', () => {
  it('only defers while held and replays exactly once on release', () => {
    let clock = 0
    const hold = createCanvasPersistenceHold({ maxHoldMs: 1_000, now: () => clock })

    expect(hold.defer()).toBe(false)
    expect(hold.release()).toBe(false)

    hold.hold()
    expect(hold.isHeld()).toBe(true)
    expect(hold.defer()).toBe(true)
    expect(hold.defer()).toBe(true)
    expect(hold.release()).toBe(true)
    expect(hold.isHeld()).toBe(false)
    expect(hold.release()).toBe(false)
    expect(hold.defer()).toBe(false)
  })

  it('stops deferring after the expiry so a lost release cannot suppress saves forever', () => {
    let clock = 0
    const hold = createCanvasPersistenceHold({ maxHoldMs: 1_000, now: () => clock })

    hold.hold()
    expect(hold.defer()).toBe(true)
    clock = 1_000
    expect(hold.isHeld()).toBe(false)
    expect(hold.defer()).toBe(false)
    expect(hold.release()).toBe(true)
  })

  it('does not replay when nothing was deferred during the hold', () => {
    const hold = createCanvasPersistenceHold()
    hold.hold()
    expect(hold.release()).toBe(false)
  })
})

describe('canvas offline draft sharing', () => {
  it('borrows the document when copy is false and copies it by default', () => {
    const source = draft('原文').document
    const namespace = { accountId: 'account-1', projectId: 'project-1', canvasId: 'canvas-1' }
    const pendingOps = [{ type: 'node.delete' as const, id: 'node-1' }]

    const copied = createCanvasOfflineDraft({ namespace, document: source, pendingOps })
    const borrowed = createCanvasOfflineDraft({ namespace, document: source, pendingOps, copy: false })

    expect(copied.document.nodes).not.toBe(source.nodes)
    expect(copied.document.nodes[0]).not.toBe(source.nodes[0])
    expect(copied.pendingOps).not.toBe(pendingOps)
    expect(borrowed.document.nodes).toBe(source.nodes)
    expect(borrowed.pendingOps).toBe(pendingOps)
    expect(borrowed.document.nodes[0]?.data?.text).toBe('原文')
  })
})
