import { describe, expect, it, vi } from 'vitest'
import { CanvasNodeDetailCache, assertCanvasNodeHydrated, hydrateCanvasDocumentForWrite } from '@/features/canvas/state/canvas-node-detail-cache'
import { buildCanvasOperations } from '@/features/canvas/state/canvas-operations'
import { flowNodeToCanvas, flowNodeToCanvasSnapshot, type CanvasFlowNode } from '@/features/canvas/editor-types'
import { createCanvasNodeDetailVersion, type CanvasDocumentInput, type CanvasNode } from '@/features/canvas/types'
import { buildCanvasNodeSummaryV1 } from '@/lib/canvas/graph-summary'

const scope = { accountId: 'account-1', projectId: 'project-1', canvasId: 'canvas-1' }
const node = (id: string, text = id): CanvasNode & { detailVersion: string } => ({
  detailVersion: createCanvasNodeDetailVersion({ data: { text }, status: 'IDLE', taskId: null, runId: null, mediaObjectId: null, parentNodeId: null }),
  id, canvasId: 'canvas-1', type: 'text', position: { x: 0, y: 0 }, size: null,
  data: { text }, status: 'IDLE', taskId: null, runId: null, mediaObjectId: null, parentNodeId: null,
})

describe('summary document hydration', () => {
  function summaryDocument() {
    const full = node('node-1', '完整正文')
    const summary = {
      ...full,
      position: { x: 120, y: 80 },
      size: { width: 400, height: 240 },
      data: { title: '摘要', __canvasUnhydrated: true },
    }
    return {
      expectedRevision: 1, clientId: 'tab', changeSummary: '移动节点', viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [summary], edges: [],
    } satisfies CanvasDocumentInput
  }

  it('hydrates a detached snapshot without mutating its summary nodes or editor geometry', async () => {
    const snapshot = summaryDocument()
    const originalNode = snapshot.nodes[0]
    const originalData = originalNode.data
    const full = node('node-1', '完整正文')
    const complete = await hydrateCanvasDocumentForWrite(snapshot, async (summary) => {
      expect(summary).toBe(originalNode)
      return full
    })

    expect(snapshot.nodes[0]).toBe(originalNode)
    expect(snapshot.nodes[0].data).toBe(originalData)
    expect(snapshot.nodes[0].data?.__canvasUnhydrated).toBe(true)
    const { detailVersion: _detailVersion, ...expected } = full
    void _detailVersion
    expect(complete.nodes[0]).toEqual({
      ...expected, position: { x: 120, y: 80 }, size: { width: 400, height: 240 },
    })
    expect(complete.nodes[0]).not.toHaveProperty('detailVersion')
    expect(complete.nodes[0].data?.__canvasUnhydrated).toBeUndefined()
  })

  it('turns a moved summary into geometry only after hydration', async () => {
    const snapshot = summaryDocument()
    const full = node('node-1', '完整正文')
    const { detailVersion: _detailVersion, ...expected } = full
    void _detailVersion
    const confirmed = { ...snapshot, nodes: [{ ...expected, position: { x: 0, y: 0 }, size: { width: 320, height: 180 } }] }
    const complete = await hydrateCanvasDocumentForWrite(snapshot, async () => full)
    expect(buildCanvasOperations(confirmed, complete, { geometryOps: true })).toEqual([
      { type: 'node.update_geometry', id: 'node-1', position: { x: 120, y: 80 }, size: { width: 400, height: 240 } },
    ])
  })

  it('hydrates only the edited card fields over the latest full detail without truncating history', async () => {
    const current = node('node-1', '完整正文')
    const history = [{ id: 'history-item', createdAt: '2026-11-01T00:00:00.000Z', status: 'ready' as const, prompt: '历史提示词'.repeat(300) }]
    const before: CanvasNode = {
      ...current, data: { text: '完整正文', title: '原始标题', generation: { modelKey: 'old', parameters: { prompt: '完整提示词' } }, history },
    }
    const summary = buildCanvasNodeSummaryV1(before)
    const local = {
      ...summary, position: { x: 25, y: 35 },
      data: { ...summary.data, __canvasUnhydrated: true, title: '本地标题', generation: { ...summary.data.generation, modelKey: 'new' } },
    }
    const snapshot = { ...summaryDocument(), nodes: [local] }
    const remote = { ...before, status: 'SUCCEEDED' as const, data: { ...before.data, contentUrl: '/api/media/synthetic-result' } }
    const result = await hydrateCanvasDocumentForWrite(snapshot, async () => remote, { ...snapshot, nodes: [summary] })

    expect(result.nodes[0]).toMatchObject({
      position: { x: 25, y: 35 },
      status: 'SUCCEEDED',
      data: { title: '本地标题', generation: { modelKey: 'new', parameters: { prompt: '完整提示词' } }, history, contentUrl: '/api/media/synthetic-result' },
    })
    expect(result.nodes[0]?.data?.__canvasUnhydrated).toBeUndefined()
  })

  it('allows summary conversion only for the internal snapshot and preserves its cache version', () => {
    const flow = {
      id: 'node-1', type: 'text', position: { x: 4, y: 8 }, width: 400, height: 240,
      detailVersion: 'version-1',
      data: { title: '摘要', __canvasUnhydrated: true, __server: { status: 'IDLE', taskId: null, runId: null, mediaObjectId: null, parentNodeId: null } },
    } as CanvasFlowNode
    expect(() => flowNodeToCanvas(flow, 'canvas-1')).toThrow('尚未加载')
    const snapshot = flowNodeToCanvasSnapshot(flow, 'canvas-1')
    expect(snapshot).toMatchObject({ detailVersion: 'version-1', position: { x: 4, y: 8 }, size: { width: 400, height: 240 } })
    expect(snapshot.data).not.toHaveProperty('__server')
  })
})


describe('CanvasNodeDetailCache', () => {
  it('isolates entries by account and detail version', async () => {
    const cache = new CanvasNodeDetailCache(async (_project, _canvas, id) => ({ detailVersion: 'version-1', node: node(id) }))
    const loaded = await cache.load(scope, 'node-1')
    expect(cache.get(scope, loaded)).toEqual(loaded)
    expect(cache.get({ ...scope, accountId: 'account-2' }, loaded)).toBeNull()
    expect(cache.get(scope, { ...loaded, detailVersion: 'version-1' })).toEqual(loaded)
    const changed = { ...loaded, data: { text: 'changed' }, detailVersion: undefined }
    expect(createCanvasNodeDetailVersion(changed)).not.toBe(createCanvasNodeDetailVersion(loaded))
    expect(cache.get(scope, changed)).toBeNull()
  })

  it('evicts the least recently used details beyond 24 nodes', async () => {
    const cache = new CanvasNodeDetailCache(async (_project, _canvas, id) => ({ detailVersion: 'version-1', node: node(id) }))
    for (let index = 0; index < 25; index += 1) await cache.load(scope, `node-${index}`)
    expect(cache.get(scope, { ...node('node-24'), detailVersion: 'version-1' })).not.toBeNull()
    expect(cache.get(scope, { ...node('node-0'), detailVersion: 'version-1' })).toBeNull()
    expect(cache.get(scope, { ...node('node-24'), detailVersion: 'version-1' })).not.toBeNull()
  })

  it('limits in-flight reads to four and rejects an aborted caller', async () => {
    let active = 0
    let peak = 0
    const releases: Array<() => void> = []
    const cache = new CanvasNodeDetailCache(async (_project, _canvas, id) => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise<void>((resolve) => releases.push(resolve))
      active -= 1
      return { detailVersion: 'version-1', node: node(id) }
    })
    const pending = Array.from({ length: 4 }, (_, index) => cache.load(scope, `node-${index}`))
    await vi.waitFor(() => expect(releases).toHaveLength(4))
    expect(peak).toBe(4)
    releases.splice(0).forEach((release) => release())
    await Promise.all(pending)
    const controller = new AbortController()
    controller.abort()
    await expect(cache.load(scope, 'aborted', controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('refuses to treat a summary shell as a writable node', () => {
    expect(() => assertCanvasNodeHydrated({ id: 'node-1', data: { __canvasUnhydrated: true } })).toThrow('尚未加载')
    expect(assertCanvasNodeHydrated({ id: 'node-1', data: { text: 'full' } }).id).toBe('node-1')
  })
})
