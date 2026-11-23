// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useCanvasAutosave, type CanvasChangeSource } from '@/features/canvas/state/useCanvasAutosave'
import { flowNodeToCanvas, flowNodeToCanvasSnapshot, canvasNodeToFlow, type CanvasFlowNode } from '@/features/canvas/editor-types'
import { hydrateCanvasDocumentForWrite } from '@/features/canvas/state/canvas-node-detail-cache'
import type { CanvasDocumentInput, CanvasNode } from '@/features/canvas/types'
import { canvasApi } from '@/features/canvas/api/client'
import { buildCanvasOperations } from '@/features/canvas/state/canvas-operations'
import { buildCanvasNodeSummaryV1 } from '@/lib/canvas/graph-summary'

const offline = vi.hoisted(() => ({
  load: vi.fn(async () => null),
  save: vi.fn(async () => undefined),
  remove: vi.fn(async () => undefined),
}))

vi.mock('@/features/canvas/state/canvas-offline-store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/canvas/state/canvas-offline-store')>()
  return {
    ...actual,
    loadCanvasOfflineDraft: offline.load,
    saveCanvasOfflineDraft: offline.save,
    deleteCanvasOfflineDraft: offline.remove,
  }
})

vi.mock('@/features/canvas/api/client', () => ({
  canvasApi: { saveOperationsDelta: vi.fn() },
  CanvasRevisionConflictError: class extends Error {},
}))

const fullNode = (position = { x: 0, y: 0 }): CanvasNode => ({
  id: 'node-1', canvasId: 'canvas-1', type: 'video', position, size: { width: 320, height: 180 },
  data: { title: '合成节点', generation: { modelKey: 'synthetic' }, history: [] },
  status: 'IDLE', taskId: null, runId: null, mediaObjectId: null, parentNodeId: null,
})

const summaryFlow = (position = { x: 0, y: 0 }): CanvasFlowNode => {
  const summary = buildCanvasNodeSummaryV1(fullNode(position))
  const node = canvasNodeToFlow(summary)
  return { ...node, detailVersion: summary.detailVersion, data: { ...node.data, __canvasUnhydrated: true } } as CanvasFlowNode
}

const documentOf = (nodes: CanvasNode[]): CanvasDocumentInput => ({
  expectedRevision: 1, clientId: 'tab', changeSummary: '移动节点', viewport: { x: 0, y: 0, zoom: 1 }, nodes, edges: [],
})

const detailOf = (position: { x: number, y: number }, title = '合成节点'): CanvasNode => ({
  ...fullNode(position), data: { ...fullNode(position).data, title },
} as CanvasNode)

describe('canvas autosave hydration race', () => {
  let root: Root
  let container: HTMLDivElement
  let current: CanvasFlowNode[]
  let viewport: { x: number; y: number; zoom: number }
  let autosave: ReturnType<typeof useCanvasAutosave>

  function Harness({ source, hydrateForDocument }: {
    source: CanvasChangeSource
    hydrateForDocument?: (document: CanvasDocumentInput) => Promise<CanvasDocumentInput>
  }) {
    autosave = useCanvasAutosave({
      accountId: 'account', projectId: 'project', canvasId: 'canvas-1', initialRevision: 1,
      buildDocument: (revision, clientId, changeSummary) => ({
        ...documentOf(current.map((node) => flowNodeToCanvasSnapshot(node, 'canvas-1'))),
        expectedRevision: revision, clientId, changeSummary,
      }),
      initialDocument: documentOf([flowNodeToCanvasSnapshot(canvasNodeToFlow(fullNode()), 'canvas-1')]),
      changeSource: source, geometryOps: true,
      hydrateForDocument: hydrateForDocument || (async (document) => {
        const complete = await hydrateCanvasDocumentForWrite(document, async (node) => ({ ...fullNode(node.position), detailVersion: 'version-1' }))
        autosave.confirmHydratedNodes(complete.nodes)
        return complete
      }),
      onSaved: () => undefined, onLoadServer: () => undefined,
      onMergeDocument: () => undefined, onRestoreLocal: () => undefined,
    })
    return null
  }

  const settleEffects = async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  const source = (): CanvasChangeSource => ({
    nodes: () => current,
    edges: () => [],
    viewport: () => viewport,
    nodeToDocument: (node) => flowNodeToCanvas(node, 'canvas-1'),
    nodeGeometryToDocument: (node) => flowNodeToCanvasSnapshot(node, 'canvas-1'),
    edgeToDocument: () => { throw new Error('unused') },
  })

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    vi.mocked(canvasApi.saveOperationsDelta).mockImplementation(async (_projectId, _canvasId, input) => ({
      canvas: {
        id: 'canvas-1', projectId: 'project', title: '合成', themeColor: null, viewport,
        revision: input.expectedRevision + 1, visibility: 'private', forkedFromId: null, createdAt: '2026-11-01', updatedAt: '2026-11-01',
      },
      nodes: [], edges: [], deletedNodeIds: [], deletedEdgeIds: [],
      geometry: input.ops.flatMap((operation) => operation.type === 'node.update_geometry' ? [{ id: operation.id, ...operation.position ? { position: operation.position } : {}, ...operation.size ? { size: operation.size } : {} }] : []),
    }))
    current = [summaryFlow()]
    viewport = { x: 0, y: 0, zoom: 1 }
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  it('keeps measurements after a save that waits for summary hydration', async () => {
    let releaseDetail!: () => void
    const detailGate = new Promise<void>((resolve) => { releaseDetail = resolve })
    const hydrateForDocument: Parameters<typeof useCanvasAutosave>[0]['hydrateForDocument'] = async (document) => hydrateCanvasDocumentForWrite(document, async (node) => {
      await detailGate
      const detail = fullNode(node.position)
      autosave.confirmHydratedNodes([detail])
      return detail
    })
    await act(async () => {
      root.render(<Harness source={source()} hydrateForDocument={hydrateForDocument} />)
      await settleEffects()
    })
    current = [{ ...current[0]!, position: { x: 50, y: 60 } }]
    vi.mocked(canvasApi.saveOperationsDelta).mockResolvedValue({
      canvas: {
        id: 'canvas-1', projectId: 'project', title: '合成', themeColor: null, viewport: { x: 0, y: 0, zoom: 1 },
        revision: 2, visibility: 'private', forkedFromId: null, createdAt: '2026-11-01', updatedAt: '2026-11-01',
      },
      nodes: [], edges: [], deletedNodeIds: [], deletedEdgeIds: [],
      geometry: [{ id: 'node-1', position: { x: 50, y: 60 } }],
    })
    let firstSave!: Promise<void>
    await act(async () => {
      autosave.scheduleSave('移动节点')
      firstSave = autosave.flush()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    current = [{ ...current[0]!, measured: { width: 320, height: 180 } }]
    act(() => { autosave.confirmMeasuredNodes(current) })
    releaseDetail()
    await act(async () => { await firstSave })
    viewport = { x: 20, y: 30, zoom: 0.6 }
    await act(async () => {
      autosave.scheduleSave('调整画布视图', { viewportOnly: true })
      await autosave.flush()
    })
    expect(vi.mocked(canvasApi.saveOperationsDelta).mock.calls[1]?.[2].ops).toEqual([
      { type: 'canvas.update_meta', viewport: { x: 20, y: 30, zoom: 0.6 } },
    ])
  })

  it('keeps later measurements when a queued hydration commits after a save', async () => {
    await act(async () => {
      root.render(<Harness source={source()} />)
      await settleEffects()
    })
    current = [{ ...current[0]!, position: { x: 50, y: 60 } }]
    let releaseSave!: () => void
    vi.mocked(canvasApi.saveOperationsDelta).mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => { releaseSave = resolve })
      return {
        canvas: {
          id: 'canvas-1', projectId: 'project', title: '合成', themeColor: null, viewport: { x: 0, y: 0, zoom: 1 },
          revision: 2, visibility: 'private', forkedFromId: null, createdAt: '2026-11-01', updatedAt: '2026-11-01',
        },
        nodes: [], edges: [], deletedNodeIds: [], deletedEdgeIds: [],
        geometry: [{ id: 'node-1', position: { x: 50, y: 60 } }],
      }
    })
    let firstSave!: Promise<void>
    await act(async () => {
      autosave.scheduleSave('移动节点')
      firstSave = autosave.flush()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    const detail = fullNode({ x: 50, y: 60 })
    current = [{ ...current[0]!, data: { ...detail.data, __server: { status: 'IDLE', taskId: null, runId: null, mediaObjectId: null, parentNodeId: null } } }]
    act(() => { autosave.confirmHydratedNodes([detail]) })
    current = [{ ...current[0]!, measured: { width: 320, height: 180 } }]
    act(() => { autosave.confirmMeasuredNodes(current) })
    releaseSave()
    await act(async () => { await firstSave })
    await act(async () => { await settleEffects() })
    viewport = { x: 20, y: 30, zoom: 0.6 }
    await act(async () => {
      autosave.scheduleSave('调整画布视图', { viewportOnly: true })
      await autosave.flush()
    })
    expect(vi.mocked(canvasApi.saveOperationsDelta).mock.calls[1]?.[2].ops).toEqual([
      { type: 'canvas.update_meta', viewport: { x: 20, y: 30, zoom: 0.6 } },
    ])
  })

  it('keeps selection-only references out of later geometry saves', async () => {
    await act(async () => {
      root.render(<Harness source={source()} />)
      await settleEffects()
    })
    current = [{ ...current[0]!, selected: true }]
    act(() => { autosave.confirmMeasuredNodes(current) })
    current = [{ ...current[0]!, position: { x: 50, y: 60 } }]
    await act(async () => {
      autosave.scheduleSave('移动选中节点')
      await autosave.flush()
    })
    expect(vi.mocked(canvasApi.saveOperationsDelta)).toHaveBeenCalledOnce()
    expect(vi.mocked(canvasApi.saveOperationsDelta).mock.calls[0]?.[2].ops).toEqual([
      { type: 'node.update_geometry', id: 'node-1', position: { x: 50, y: 60 } },
    ])
  })

  it('keeps measured dimensions out of a viewport-only save', async () => {
    await act(async () => {
      root.render(<Harness source={source()} />)
      await settleEffects()
    })
    current = [{ ...current[0]!, measured: { width: 360, height: 220 } }]
    act(() => { autosave.confirmMeasuredNodes(current) })
    expect(current[0]?.measured).toEqual({ width: 360, height: 220 })
    viewport = { x: 20, y: 30, zoom: 0.6 }
    await act(async () => {
      autosave.scheduleSave('调整画布视图', { viewportOnly: true })
      await autosave.flush()
    })
    expect(vi.mocked(canvasApi.saveOperationsDelta)).toHaveBeenCalledOnce()
    expect(vi.mocked(canvasApi.saveOperationsDelta).mock.calls[0]?.[2].ops).toEqual([
      { type: 'canvas.update_meta', viewport: { x: 20, y: 30, zoom: 0.6 } },
    ])
  })

  it('saves a pure viewport update without reading the node or edge collections', async () => {
    const changeSource = source()
    const nodes = vi.spyOn(changeSource, 'nodes')
    const edges = vi.spyOn(changeSource, 'edges')
    await act(async () => {
      root.render(<Harness source={changeSource} />)
      await settleEffects()
    })
    nodes.mockClear()
    edges.mockClear()
    viewport = { x: 15, y: 25, zoom: 0.7 }
    await act(async () => {
      autosave.scheduleSave('调整画布视图', { viewportOnly: true })
      await autosave.flush()
    })
    expect(vi.mocked(canvasApi.saveOperationsDelta).mock.calls[0]?.[2].ops).toEqual([
      { type: 'canvas.update_meta', viewport },
    ])
    expect(nodes).not.toHaveBeenCalled()
    expect(edges).not.toHaveBeenCalled()
  })

  it('does not confirm an unsaved body edit merely because the node was measured', async () => {
    const hydrated = canvasNodeToFlow(fullNode())
    current = [hydrated]
    await act(async () => {
      root.render(<Harness source={source()} />)
      await settleEffects()
    })
    current = [{ ...hydrated, data: { ...hydrated.data, title: '未保存的标题' }, measured: { width: 320, height: 180 } }]
    act(() => autosave.confirmMeasuredNodes(current))
    await act(async () => {
      autosave.scheduleSave('改名')
      await autosave.flush()
    })
    expect(vi.mocked(canvasApi.saveOperationsDelta).mock.calls[0]?.[2].ops).toEqual([
      { type: 'node.upsert', node: expect.objectContaining({ data: expect.objectContaining({ title: '未保存的标题' }) }) },
    ])
  })

  it('does not mistake a drag made before detail hydration for confirmed geometry', async () => {
    await act(async () => {
      root.render(<Harness source={source()} />)
      await settleEffects()
    })
    const position = { x: 98, y: 45 }
    const hydrated = fullNode(position)
    current = [canvasNodeToFlow(hydrated)]
    act(() => autosave.confirmHydratedNodes([hydrated]))
    await act(async () => {
      autosave.scheduleSave('移动节点')
      await autosave.flush()
    })
    expect(vi.mocked(canvasApi.saveOperationsDelta).mock.calls[0]?.[2].ops).toEqual([
      { type: 'node.update_geometry', id: 'node-1', position },
    ])
  })

  it('journals an unhydrated drag without fetching any node details', async () => {
    const hydrate = vi.fn(async (snapshot: CanvasDocumentInput) => snapshot)
    await act(async () => {
      root.render(<Harness source={source()} hydrateForDocument={hydrate} />)
      await settleEffects()
    })
    const position = { x: 80, y: 100 }
    current = [{ ...current[0]!, position }]
    act(() => autosave.scheduleSave('移动节点'))
    await vi.waitFor(() => expect(offline.save).toHaveBeenCalledWith(expect.objectContaining({
      schema_version: 2,
      document: expect.objectContaining({ nodes: [], edges: [] }),
      pendingOps: [{ type: 'node.update_geometry', id: 'node-1', position }],
    })))
    expect(hydrate).not.toHaveBeenCalled()
    await act(async () => { await autosave.flush() })
  })

  it('does not upsert a detail that arrives while its geometry save is in flight', async () => {
    let releaseSave!: () => void
    const saveGate = new Promise<void>((resolve) => { releaseSave = resolve })
    vi.mocked(canvasApi.saveOperationsDelta).mockImplementation(async () => {
      await saveGate
      return {
        canvas: {
          id: 'canvas-1', projectId: 'project', title: '合成', themeColor: null, viewport: { x: 0, y: 0, zoom: 1 },
          revision: 2, visibility: 'private', forkedFromId: null, createdAt: '2026-11-01', updatedAt: '2026-11-01',
        },
        nodes: [], edges: [], deletedNodeIds: [], deletedEdgeIds: [],
        geometry: [{ id: 'node-1', position: { x: 50, y: 60 } }],
      }
    })
    await act(async () => {
      root.render(<Harness source={source()} />)
      await settleEffects()
    })

    expect({ state: autosave.saveState, recovery: autosave.offlineRecoveryState, loads: offline.load.mock.calls.length })
      .toMatchObject({ state: 'idle', recovery: 'none', loads: 1 })

    current = [{ ...current[0]!, position: { x: 50, y: 60 } }]
    await act(async () => { autosave.scheduleSave('移动节点') })
    let firstSave!: Promise<void>
    await act(async () => {
      firstSave = autosave.flush()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(vi.mocked(canvasApi.saveOperationsDelta)).toHaveBeenCalledOnce()

    const detail = fullNode({ x: 50, y: 60 })
    current = [{ ...current[0]!, data: { ...detail.data, __server: { status: 'IDLE', taskId: null, runId: null, mediaObjectId: null, parentNodeId: null } } }]
    act(() => { autosave.confirmHydratedNodes([detail]) })
    await act(async () => {
      autosave.scheduleSave('水合后位置同步')
      releaseSave()
      await firstSave
    })

    current = [{ ...current[0]!, position: { x: 80, y: 90 } }]
    vi.mocked(canvasApi.saveOperationsDelta).mockImplementation(async () => ({
      canvas: {
        id: 'canvas-1', projectId: 'project', title: '合成', themeColor: null, viewport: { x: 0, y: 0, zoom: 1 },
        revision: 2, visibility: 'private', forkedFromId: null, createdAt: '2026-11-01', updatedAt: '2026-11-01',
      },
      nodes: [], edges: [], deletedNodeIds: [], deletedEdgeIds: [],
      geometry: [{ id: 'node-1', position: { x: 80, y: 90 } }],
    }))
    await act(async () => {
      autosave.scheduleSave('再次移动节点')
      await autosave.flush()
    })
    const calls = vi.mocked(canvasApi.saveOperationsDelta).mock.calls
    expect(calls).toHaveLength(2)
    expect(calls[0]?.[2].ops).toEqual([{ type: 'node.update_geometry', id: 'node-1', position: { x: 50, y: 60 } }])
    expect(calls[1]?.[2].ops).toEqual([{ type: 'node.update_geometry', id: 'node-1', position: { x: 80, y: 90 } }])
  })

  it('does not rebase an edit that follows a measurement during a save', async () => {
    let releaseSave!: () => void
    const saveGate = new Promise<void>((resolve) => { releaseSave = resolve })
    vi.mocked(canvasApi.saveOperationsDelta).mockImplementation(async () => {
      await saveGate
      return {
        canvas: {
          id: 'canvas-1', projectId: 'project', title: '合成', themeColor: null, viewport: { x: 0, y: 0, zoom: 1 },
          revision: 2, visibility: 'private', forkedFromId: null, createdAt: '2026-11-01', updatedAt: '2026-11-01',
        },
        nodes: [], edges: [], deletedNodeIds: [], deletedEdgeIds: [],
        geometry: [{ id: 'node-1', position: { x: 50, y: 60 } }],
      }
    })
    await act(async () => {
      root.render(<Harness source={source()} />)
      await settleEffects()
    })
    current = [{ ...current[0]!, position: { x: 50, y: 60 } }]
    await act(async () => { autosave.scheduleSave('移动节点') })
    let firstSave!: Promise<void>
    await act(async () => {
      firstSave = autosave.flush()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    const measured = [{ ...current[0]!, measured: { width: 360, height: 220 } }]
    current = measured
    act(() => { autosave.confirmMeasuredNodes(measured) })
    current = [{ ...current[0]!, position: { x: 80, y: 90 } }]
    releaseSave()
    await act(async () => { await firstSave })
    await act(async () => {
      autosave.scheduleSave('再次移动节点')
      await autosave.flush()
    })
    const calls = vi.mocked(canvasApi.saveOperationsDelta).mock.calls
    expect(calls).toHaveLength(2)
    expect(calls[1]?.[2].ops).toEqual([{ type: 'node.update_geometry', id: 'node-1', position: { x: 80, y: 90 } }])
  })

  it('does not rebase an edit that follows hydration during a save', async () => {
    let releaseSave!: () => void
    const saveGate = new Promise<void>((resolve) => { releaseSave = resolve })
    vi.mocked(canvasApi.saveOperationsDelta).mockImplementation(async () => {
      await saveGate
      return {
        canvas: {
          id: 'canvas-1', projectId: 'project', title: '合成', themeColor: null, viewport: { x: 0, y: 0, zoom: 1 },
          revision: 2, visibility: 'private', forkedFromId: null, createdAt: '2026-11-01', updatedAt: '2026-11-01',
        },
        nodes: [], edges: [], deletedNodeIds: [], deletedEdgeIds: [],
        geometry: [{ id: 'node-1', position: { x: 50, y: 60 } }],
      }
    })
    await act(async () => {
      root.render(<Harness source={source()} />)
      await settleEffects()
    })
    current = [{ ...current[0]!, position: { x: 50, y: 60 } }]
    await act(async () => { autosave.scheduleSave('移动节点') })
    let firstSave!: Promise<void>
    await act(async () => {
      firstSave = autosave.flush()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    const detail = fullNode({ x: 50, y: 60 })
    current = [{ ...current[0]!, data: { ...detail.data, __server: { status: 'IDLE', taskId: null, runId: null, mediaObjectId: null, parentNodeId: null } } }]
    act(() => { autosave.confirmHydratedNodes([detail]) })
    current = [{ ...current[0]!, position: { x: 80, y: 90 } }]
    releaseSave()
    await act(async () => { await firstSave })
    vi.mocked(canvasApi.saveOperationsDelta).mockResolvedValue({
      canvas: {
        id: 'canvas-1', projectId: 'project', title: '合成', themeColor: null, viewport: { x: 0, y: 0, zoom: 1 },
        revision: 3, visibility: 'private', forkedFromId: null, createdAt: '2026-11-01', updatedAt: '2026-11-01',
      },
      nodes: [], edges: [], deletedNodeIds: [], deletedEdgeIds: [],
      geometry: [{ id: 'node-1', position: { x: 80, y: 90 } }],
    })
    await act(async () => {
      autosave.scheduleSave('水合后再次移动节点')
      await autosave.flush()
    })
    const calls = vi.mocked(canvasApi.saveOperationsDelta).mock.calls
    expect(calls).toHaveLength(2)
    expect(calls[1]?.[2].ops).toEqual([{ type: 'node.update_geometry', id: 'node-1', position: { x: 80, y: 90 } }])
  })

  it('does not rebase measured references when asynchronous session setup reruns', async () => {
    function SessionHarness({ accountId }: { accountId: string }) {
      autosave = useCanvasAutosave({
        accountId, projectId: 'project', canvasId: 'canvas-1', initialRevision: 1,
        buildDocument: (revision, clientId, changeSummary) => ({
          ...documentOf(current.map((node) => flowNodeToCanvasSnapshot(node, 'canvas-1'))),
          expectedRevision: revision, clientId, changeSummary,
        }),
        initialDocument: documentOf([flowNodeToCanvasSnapshot(canvasNodeToFlow(fullNode()), 'canvas-1')]),
        changeSource: source(), geometryOps: true,
        onSaved: () => undefined, onLoadServer: () => undefined,
        onMergeDocument: () => undefined, onRestoreLocal: () => undefined,
      })
      return null
    }
    await act(async () => { root.render(<SessionHarness accountId="" />) })
    current = [{ ...current[0]!, measured: { width: 320, height: 180 } }]
    act(() => { autosave.confirmMeasuredNodes(current) })
    await act(async () => {
      root.render(<SessionHarness accountId="account" />)
      await settleEffects()
    })
    viewport = { x: 20, y: 30, zoom: 0.6 }
    await act(async () => {
      autosave.scheduleSave('调整画布视图', { viewportOnly: true })
      await autosave.flush()
    })
    expect(vi.mocked(canvasApi.saveOperationsDelta).mock.calls[0]?.[2].ops).toEqual([
      { type: 'canvas.update_meta', viewport: { x: 20, y: 30, zoom: 0.6 } },
    ])
  })

  it('keeps unsaved drag geometry when a newly mounted summary node is measured', async () => {
    await act(async () => {
      root.render(<Harness source={source()} />)
      await settleEffects()
    })
    current = [{ ...current[0]!, position: { x: 50, y: 60 } }]
    const measured = [{ ...current[0]!, measured: { width: 360, height: 220 } }]
    current = measured
    act(() => { autosave.confirmMeasuredNodes(measured) })
    await act(async () => {
      autosave.scheduleSave('移动节点')
      await autosave.flush()
    })
    expect(vi.mocked(canvasApi.saveOperationsDelta)).toHaveBeenCalledOnce()
    expect(vi.mocked(canvasApi.saveOperationsDelta).mock.calls[0]?.[2].ops).toEqual([
      { type: 'node.update_geometry', id: 'node-1', position: { x: 50, y: 60 } },
    ])
  })

  it('preserves measurement confirmations that arrive during summary hydration', async () => {
    const hydrateForDocument: Parameters<typeof useCanvasAutosave>[0]['hydrateForDocument'] = async (document) => hydrateCanvasDocumentForWrite(document, async (node) => {
      await new Promise((resolve) => setTimeout(resolve, 0))
      const detail = fullNode(node.position)
      autosave.confirmHydratedNodes([detail])
      return detail
    })
    await act(async () => {
      root.render(<Harness source={source()} hydrateForDocument={hydrateForDocument} />)
      await settleEffects()
    })
    current = [{ ...current[0]!, position: { x: 50, y: 60 } }]
    vi.mocked(canvasApi.saveOperationsDelta).mockResolvedValue({
      canvas: {
        id: 'canvas-1', projectId: 'project', title: '合成', themeColor: null, viewport: { x: 0, y: 0, zoom: 1 },
        revision: 2, visibility: 'private', forkedFromId: null, createdAt: '2026-11-01', updatedAt: '2026-11-01',
      },
      nodes: [], edges: [], deletedNodeIds: [], deletedEdgeIds: [],
      geometry: [{ id: 'node-1', position: { x: 50, y: 60 } }],
    })
    let firstSave!: Promise<void>
    await act(async () => {
      autosave.scheduleSave('移动节点')
      firstSave = autosave.flush()
      await settleEffects()
    })
    expect(vi.mocked(canvasApi.saveOperationsDelta)).toHaveBeenCalledOnce()
    const measured = [{ ...current[0]!, measured: { width: 360, height: 220 } }]
    current = measured
    act(() => { autosave.confirmMeasuredNodes(measured) })
    await act(async () => { await firstSave })
    current = [{ ...current[0]!, position: { x: 80, y: 90 } }]
    await act(async () => {
      autosave.scheduleSave('再次移动节点')
      await autosave.flush()
    })
    const calls = vi.mocked(canvasApi.saveOperationsDelta).mock.calls
    expect(calls).toHaveLength(2)
    expect(calls[1]?.[2].ops).toEqual([{ type: 'node.update_geometry', id: 'node-1', position: { x: 80, y: 90 } }])
  })

  it('preserves measurement confirmations before the first network request starts', async () => {
    await act(async () => {
      root.render(<Harness source={source()} />)
      await settleEffects()
    })
    current = [{ ...current[0]!, position: { x: 50, y: 60 } }]
    vi.mocked(canvasApi.saveOperationsDelta).mockResolvedValue({
      canvas: {
        id: 'canvas-1', projectId: 'project', title: '合成', themeColor: null, viewport: { x: 0, y: 0, zoom: 1 },
        revision: 2, visibility: 'private', forkedFromId: null, createdAt: '2026-11-01', updatedAt: '2026-11-01',
      },
      nodes: [], edges: [], deletedNodeIds: [], deletedEdgeIds: [],
      geometry: [{ id: 'node-1', position: { x: 50, y: 60 } }],
    })
    let firstSave!: Promise<void>
    await act(async () => {
      autosave.scheduleSave('移动节点')
      firstSave = autosave.flush()
    })
    const measured = [{ ...current[0]!, measured: { width: 360, height: 220 } }]
    current = measured
    act(() => { autosave.confirmMeasuredNodes(measured) })
    await act(async () => { await firstSave })
    current = [{ ...current[0]!, position: { x: 80, y: 90 } }]
    await act(async () => {
      autosave.scheduleSave('再次移动节点')
      await autosave.flush()
    })
    const calls = vi.mocked(canvasApi.saveOperationsDelta).mock.calls
    expect(calls).toHaveLength(2)
    expect(calls[1]?.[2].ops).toEqual([{ type: 'node.update_geometry', id: 'node-1', position: { x: 80, y: 90 } }])
  })

  it('requires complete hydration when a summary body changes', async () => {
    const hydrated: Parameters<typeof useCanvasAutosave>[0]['hydrateForDocument'] = async (document, confirmed) =>
      hydrateCanvasDocumentForWrite(document, async (node) => fullNode(node.position), confirmed)
    await act(async () => {
      root.render(<Harness source={source()} hydrateForDocument={hydrated} />)
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(autosave.offlineRecoveryState).toBe('none')
    current = current.map((node) => ({ ...node, data: { ...node.data, title: '本地修改标题' } }))
    expect(buildCanvasOperations(documentOf([flowNodeToCanvasSnapshot(summaryFlow(), 'canvas-1')]), documentOf(current.map((node) => flowNodeToCanvasSnapshot(node, 'canvas-1'))), { geometryOps: true })).toEqual([
      { type: 'node.upsert', node: expect.objectContaining({ id: 'node-1' }) },
    ])
    await act(async () => {
      autosave.scheduleSave('编辑摘要正文')
      await autosave.flush()
    })

    expect(autosave.saveState).toBe('saved')
    expect(vi.mocked(canvasApi.saveOperationsDelta)).toHaveBeenCalledOnce()
    const operation = vi.mocked(canvasApi.saveOperationsDelta).mock.calls[0]?.[2].ops[0]
    expect(operation?.type).toBe('node.upsert')
    expect(operation?.type === 'node.upsert' && operation.node.data).toMatchObject({ title: '本地修改标题' })
    expect(operation?.type === 'node.upsert' && operation.node.data?.__canvasUnhydrated).toBeUndefined()
  })
})
