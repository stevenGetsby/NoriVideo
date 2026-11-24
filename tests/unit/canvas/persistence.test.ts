import { describe, expect, it, vi } from 'vitest'
import {
  applyCanvasOperationsInTransaction,
  mergeCanvasTerminalNodeState,
  replaceCanvasDocumentInTransaction,
  shouldRecordCanvasSnapshot,
} from '@/lib/canvas/persistence'
import type { CanvasDocumentSaveInput } from '@/lib/canvas/document'
import { DEFAULT_STUDIO_SCENE } from '@/features/canvas/studio-types'

function input(): CanvasDocumentSaveInput {
  return {
    schema_version: 1,
    expectedRevision: 5,
    clientId: 'tab-1',
    changeSummary: '保存画布',
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [{
      id: 'node-1',
      type: 'image',
      position: { x: 10, y: 20 },
      size: { width: 300, height: 200 },
      data: { title: '图片' },
      status: 'IDLE',
      taskId: null,
      runId: null,
      mediaObjectId: null,
      parentNodeId: null,
    }],
    edges: [],
  }
}

function transaction(claimed = 1) {
  return {
    $queryRaw: vi.fn(async (): Promise<unknown[]> => []),
    canvas: {
      updateMany: vi.fn(async () => ({ count: claimed })),
      findFirst: vi.fn(async () => ({ revision: 6 })),
      findUnique: vi.fn(async (): Promise<unknown> => ({ viewport: { x: 0, y: 0, zoom: 1 } })),
      findUniqueOrThrow: vi.fn(async () => ({ id: 'canvas-1', revision: 6, viewport: { x: 0, y: 0, zoom: 1 } })),
    },
    canvasEdge: {
      findMany: vi.fn(async (): Promise<unknown[]> => []),
      deleteMany: vi.fn(async () => ({ count: 0 })),
      createMany: vi.fn(async () => ({ count: 0 })),
    },
    canvasNode: {
      findMany: vi.fn(async (): Promise<unknown[]> => []),
      findFirst: vi.fn(async (): Promise<unknown> => null),
      deleteMany: vi.fn(async () => ({ count: 0 })),
      createMany: vi.fn(async () => ({ count: 1 })),
      updateMany: vi.fn(async () => ({ count: 1 })),
      create: vi.fn(async () => ({ id: 'node-new' })),
    },
    canvasSnapshot: {
      findFirst: vi.fn(async (): Promise<unknown> => null),
      findUnique: vi.fn(async (): Promise<unknown> => null),
      create: vi.fn(async () => ({ id: 'snapshot-6' })),
      findMany: vi.fn(async (): Promise<unknown[]> => []),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    canvasStudio3DDocument: {
      findFirst: vi.fn(async (): Promise<unknown> => null),
      findMany: vi.fn(async (): Promise<unknown[]> => []),
      create: vi.fn(async () => ({ id: 'studio-document-1' })),
      createMany: vi.fn(async () => ({ count: 0 })),
      updateMany: vi.fn(async () => ({ count: 1 })),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    canvasStudio3DDocumentSnapshot: {
      createMany: vi.fn(async () => ({ count: 0 })),
    },
    canvasWorkflowTemplate: {
      findFirst: vi.fn(async () => null),
    },
  }
}

describe('canvas snapshot throttling', () => {
  it('records the first snapshot and bypasses throttling for a history restore or large deletion', async () => {
    const tx = transaction()
    await expect(shouldRecordCanvasSnapshot(tx as never, 'canvas-1')).resolves.toBe(true)
    expect(tx.canvasSnapshot.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { canvasId: 'canvas-1' },
      orderBy: { createdAt: 'desc' },
    }))
    await expect(shouldRecordCanvasSnapshot(tx as never, 'canvas-1', 5)).resolves.toBe(true)
    expect(tx.canvasSnapshot.findFirst).toHaveBeenCalledOnce()
  })

  it('skips a recent snapshot without pruning existing history', async () => {
    const tx = transaction()
    tx.canvasSnapshot.findFirst.mockResolvedValue({ createdAt: new Date() })
    await replaceCanvasDocumentInTransaction(tx as never, {
      projectId: 'project-1',
      canvasId: 'canvas-1',
      userId: 'user-1',
      input: input(),
    })
    expect(tx.canvasSnapshot.create).not.toHaveBeenCalled()
    expect(tx.canvasSnapshot.findMany).not.toHaveBeenCalled()
    expect(tx.canvasSnapshot.deleteMany).not.toHaveBeenCalled()
  })

  it('records again after five minutes and forces history restores immediately', async () => {
    const tx = transaction()
    tx.canvasSnapshot.findFirst.mockResolvedValue({ createdAt: new Date(Date.now() - 5 * 60_000) })
    await expect(shouldRecordCanvasSnapshot(tx as never, 'canvas-1')).resolves.toBe(true)

    const restore = transaction()
    await replaceCanvasDocumentInTransaction(restore as never, {
      projectId: 'project-1',
      canvasId: 'canvas-1',
      userId: 'user-1',
      input: input(),
      forceSnapshot: true,
    })
    expect(restore.canvasSnapshot.findFirst).not.toHaveBeenCalled()
    expect(restore.canvasSnapshot.create).toHaveBeenCalledOnce()
  })
})


describe('canvas document persistence', () => {
  it('claims the expected revision before replacing graph rows', async () => {
    const tx = transaction()
    const canvas = await replaceCanvasDocumentInTransaction(tx as never, {
      projectId: 'project-1',
      canvasId: 'canvas-1',
      userId: 'user-1',
      input: input(),
    })

    expect(canvas).toMatchObject({
      canvas: { id: 'canvas-1', revision: 6 },
      nodes: [{ id: 'node-1', canvasId: 'canvas-1' }],
      edges: [],
    })
    expect(tx.canvas.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'canvas-1', projectId: 'project-1', revision: 5 },
    }))
    expect(tx.canvasNode.createMany).toHaveBeenCalledOnce()
    expect(tx.canvasSnapshot.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        revision: 6,
        clientId: 'tab-1',
        document: expect.objectContaining({ schema_version: 1 }),
      }),
    }))
  })

  it('atomically replaces a populated canvas with an empty revisioned snapshot', async () => {
    const tx = transaction()
    tx.canvasNode.findMany.mockResolvedValueOnce([input().nodes[0]])

    const graph = await replaceCanvasDocumentInTransaction(tx as never, {
      projectId: 'project-1',
      canvasId: 'canvas-1',
      userId: 'user-1',
      input: {
        ...input(),
        changeSummary: '清空画布',
        nodes: [],
        edges: [],
      },
    })

    expect(tx.canvas.updateMany).toHaveBeenCalledWith({
      where: { id: 'canvas-1', projectId: 'project-1', revision: 5 },
      data: {
        revision: { increment: 1 },
        viewport: { x: 0, y: 0, zoom: 1 },
      },
    })
    expect(tx.canvasEdge.deleteMany).toHaveBeenCalledWith({ where: { canvasId: 'canvas-1' } })
    expect(tx.canvasNode.deleteMany).toHaveBeenCalledWith({
      where: { canvasId: 'canvas-1', id: { in: ['node-1'] } },
    })
    expect(tx.canvasNode.createMany).not.toHaveBeenCalled()
    expect(tx.canvasEdge.createMany).not.toHaveBeenCalled()
    expect(tx.canvasSnapshot.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        revision: 6,
        changeSummary: '清空画布',
        document: {
          schema_version: 1,
          viewport: { x: 0, y: 0, zoom: 1 },
          nodes: [],
          edges: [],
        },
      }),
    }))
    expect(graph).toMatchObject({
      canvas: { id: 'canvas-1', revision: 6 },
      nodes: [],
      edges: [],
    })
  })

  it('keeps an existing studio node row so canvas autosave cannot cascade-delete its independent document', async () => {
    const tx = transaction()
    const studioNode = {
      ...input().nodes[0],
      id: 'studio-1',
      type: 'studio_3d',
      data: { title: '导演台' },
    }
    tx.canvasNode.findMany.mockResolvedValueOnce([{
      id: studioNode.id,
      status: studioNode.status,
      taskId: studioNode.taskId,
      runId: studioNode.runId,
      mediaObjectId: studioNode.mediaObjectId,
      data: studioNode.data,
    }])

    await replaceCanvasDocumentInTransaction(tx as never, {
      projectId: 'project-1',
      canvasId: 'canvas-1',
      userId: 'user-1',
      input: { ...input(), nodes: [studioNode] },
    })

    expect(tx.canvasNode.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'studio-1', canvasId: 'canvas-1' },
    }))
    expect(tx.canvasNode.deleteMany).not.toHaveBeenCalled()
    expect(tx.canvasNode.createMany).not.toHaveBeenCalled()
    expect(tx.canvasStudio3DDocument.deleteMany).not.toHaveBeenCalled()
  })

  describe('stale whole-document replays', () => {
    const storedNode = (id: string) => ({ ...input().nodes[0], id })
    const storedEdge = (id: string, source: string, target: string) => ({ id, sourceNodeId: source, targetNodeId: target, sourceHandle: 'output', targetHandle: 'input', role: 'STORY_FLOW' })

    it('refuses a full-document save that drops far more than a person deletes, and writes nothing', async () => {
      const tx = transaction()
      const existing = Array.from({ length: 100 }, (_, index) => storedNode(`n${index}`))
      tx.canvasNode.findMany.mockResolvedValueOnce(existing)
      await expect(replaceCanvasDocumentInTransaction(tx as never, {
        projectId: 'project-1',
        canvasId: 'canvas-1',
        userId: 'user-1',
        input: { ...input(), changeSummary: '恢复本地未同步版本', nodes: existing.slice(0, 55) },
      })).rejects.toMatchObject({ code: 'CONFLICT', details: expect.objectContaining({ reason: 'CANVAS_BULK_REMOVAL_BLOCKED' }) })
      expect(tx.canvasEdge.deleteMany).not.toHaveBeenCalled()
      expect(tx.canvasNode.deleteMany).not.toHaveBeenCalled()
      expect(tx.canvasSnapshot.create).not.toHaveBeenCalled()
    })

    it('refuses a replay that keeps every node but rewrites away most edges', async () => {
      const tx = transaction()
      const nodes = Array.from({ length: 60 }, (_, index) => storedNode(`n${index}`))
      const edges = Array.from({ length: 59 }, (_, index) => storedEdge(`e${index}`, `n${index}`, `n${index + 1}`))
      tx.canvasNode.findMany.mockResolvedValueOnce(nodes)
      tx.canvasEdge.findMany.mockResolvedValueOnce(edges)
      await expect(replaceCanvasDocumentInTransaction(tx as never, {
        projectId: 'project-1',
        canvasId: 'canvas-1',
        userId: 'user-1',
        input: { ...input(), nodes, edges: edges.slice(0, 20).map((edge) => ({ ...edge })) },
      })).rejects.toMatchObject({ code: 'CONFLICT' })
      expect(tx.canvasEdge.deleteMany).not.toHaveBeenCalled()
    })

    it('snapshots the previous graph before a small full-document removal overwrites it', async () => {
      const tx = transaction()
      const existing = Array.from({ length: 100 }, (_, index) => storedNode(`n${index}`))
      tx.canvasNode.findMany.mockResolvedValueOnce(existing)
      await replaceCanvasDocumentInTransaction(tx as never, {
        projectId: 'project-1',
        canvasId: 'canvas-1',
        userId: 'user-1',
        input: { ...input(), nodes: existing.slice(0, 98) },
      })
      const calls = tx.canvasSnapshot.create.mock.calls as unknown as Array<[{ data: { revision: number; changeSummary: string; document: { nodes: unknown[] } } }]>
      const previous = calls.find(([call]) => call.data.revision === 5)
      expect(previous?.[0].data.changeSummary).toBe('整文档覆盖前自动备份')
      expect(previous?.[0].data.document.nodes).toHaveLength(100)
    })

    it('does not duplicate a snapshot the previous revision already has', async () => {
      const tx = transaction()
      const existing = Array.from({ length: 20 }, (_, index) => storedNode(`n${index}`))
      tx.canvasNode.findMany.mockResolvedValueOnce(existing)
      tx.canvasSnapshot.findUnique.mockResolvedValueOnce({ id: 'snapshot-5' })
      await replaceCanvasDocumentInTransaction(tx as never, {
        projectId: 'project-1',
        canvasId: 'canvas-1',
        userId: 'user-1',
        input: { ...input(), nodes: existing.slice(0, 19) },
      })
      const calls = tx.canvasSnapshot.create.mock.calls as unknown as Array<[{ data: { revision: number } }]>
      expect(calls.some(([call]) => call.data.revision === 5)).toBe(false)
    })
  })

  it('stops without deleting nodes when another tab owns the revision', async () => {
    const tx = transaction(0)
    await expect(replaceCanvasDocumentInTransaction(tx as never, {
      projectId: 'project-1',
      canvasId: 'canvas-1',
      userId: 'user-1',
      input: input(),
    })).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(tx.canvasNode.deleteMany).not.toHaveBeenCalled()
    expect(tx.canvasSnapshot.create).not.toHaveBeenCalled()
  })

  it('preserves a reconciled task terminal state over a stale RUNNING autosave', () => {
    const stale = {
      ...input().nodes[0],
      status: 'RUNNING',
      taskId: 'task-1',
      data: { prompt: '保留编辑', progress: 20, pollErrorMessage: '暂时无法读取状态' },
    }
    const merged = mergeCanvasTerminalNodeState({
      id: stale.id,
      status: 'SUCCEEDED',
      taskId: 'task-1',
      runId: null,
      mediaObjectId: 'media-1',
      data: {
        progress: 100,
        contentUrl: '/result.png',
        sourceMetadata: { durationSeconds: 5 },
        pollErrorMessage: null,
        history: [{ id: 'result', status: 'ready' }],
      },
    }, stale)

    expect(merged).toMatchObject({
      status: 'SUCCEEDED',
      taskId: 'task-1',
      mediaObjectId: 'media-1',
      data: {
        prompt: '保留编辑',
        progress: 100,
        contentUrl: '/result.png',
        sourceMetadata: { durationSeconds: 5 },
        pollErrorMessage: null,
        history: [{ id: 'result', status: 'ready' }],
      },
    })
  })

  it('preserves a worker-bound storyboard shot over a stale planning autosave', () => {
    const stale = {
      ...input().nodes[0],
      id: 'story-source',
      status: 'RUNNING',
      taskId: 'task-plan',
      data: {
        prompt: '原始剧情',
        generation: { modelKey: 'image-model', count: 4 },
        generationTask: { kind: 'storyboard_plan', taskId: 'task-plan' },
      },
    }
    const merged = mergeCanvasTerminalNodeState({
      id: stale.id,
      status: 'RUNNING',
      taskId: 'task-image-1',
      runId: null,
      mediaObjectId: null,
      data: {
        prompt: '镜头一提示词',
        storyboardPlanningTaskId: 'task-plan',
        storyboardIndex: 1,
        generationTask: null,
        generation: { modelKey: 'image-model', assetId: 'asset-1', taskId: 'task-image-1', count: 1 },
      },
    }, { ...stale, position: { x: 900, y: 600 } })

    expect(merged).toMatchObject({
      position: { x: 900, y: 600 },
      status: 'RUNNING',
      taskId: 'task-image-1',
      data: {
        prompt: '镜头一提示词',
        storyboardPlanningTaskId: 'task-plan',
        generationTask: null,
        generation: { assetId: 'asset-1', taskId: 'task-image-1' },
      },
    })
  })

  it('keeps server-created storyboard siblings and edges during a stale full-document recovery', async () => {
    const tx = transaction()
    const staleSource = {
      ...input().nodes[0],
      id: 'story-source',
      status: 'RUNNING',
      taskId: 'task-plan',
      data: {
        prompt: '原始剧情',
        generation: { modelKey: 'image-model', count: 4 },
        generationTask: { kind: 'storyboard_plan', taskId: 'task-plan' },
      },
    }
    const storedSource = {
      ...staleSource,
      taskId: 'task-image-1',
      data: {
        prompt: '镜头一提示词',
        storyboardPlanningTaskId: 'task-plan',
        generationTask: null,
        generation: { assetId: 'asset-1', taskId: 'task-image-1' },
      },
    }
    const sibling = {
      ...storedSource,
      id: 'story-shot-2',
      taskId: 'task-image-2',
      parentNodeId: 'story-source',
      position: { x: 356, y: 20 },
      data: {
        ...storedSource.data,
        storyboardIndex: 2,
        generation: { assetId: 'asset-2', taskId: 'task-image-2' },
      },
    }
    const group = {
      ...storedSource,
      id: 'story-group',
      type: 'group',
      taskId: null,
      status: 'IDLE',
      parentNodeId: null,
      data: {
        storyboardPlanningTaskId: 'task-plan',
        memberIds: ['story-source', 'story-shot-2'],
      },
    }
    tx.canvasNode.findMany.mockResolvedValueOnce([storedSource, sibling, group])
    tx.canvasEdge.findMany.mockResolvedValueOnce([{
      id: 'story-edge-2',
      sourceNodeId: 'story-source',
      targetNodeId: 'story-shot-2',
      sourceHandle: 'output',
      targetHandle: 'input',
      role: 'REF',
    }])

    const graph = await replaceCanvasDocumentInTransaction(tx as never, {
      projectId: 'project-1',
      canvasId: 'canvas-1',
      userId: 'user-1',
      input: { ...input(), nodes: [staleSource], edges: [] },
    })

    expect(graph.nodes.map((node) => node.id)).toEqual(['story-source', 'story-shot-2', 'story-group'])
    expect(graph.nodes[0]).toMatchObject({ taskId: 'task-image-1', data: { prompt: '镜头一提示词' } })
    expect(graph.edges).toEqual([expect.objectContaining({ id: 'story-edge-2', targetNodeId: 'story-shot-2' })])
    expect(tx.canvasNode.deleteMany).not.toHaveBeenCalled()
    expect(tx.canvasEdge.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ id: 'story-edge-2', canvasId: 'canvas-1' })],
    })
  })

  it('re-reads and reapplies terminal truth when reconciliation wins the full-PUT write race', async () => {
    const tx = transaction()
    const stale = { ...input().nodes[0], status: 'RUNNING', taskId: 'task-1', data: { prompt: '本地编辑', progress: 20 } }
    tx.canvasNode.findMany.mockResolvedValueOnce([{
      id: stale.id,
      status: 'RUNNING',
      taskId: 'task-1',
      runId: null,
      mediaObjectId: null,
      data: stale.data,
    }])
    tx.canvasNode.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 })
    tx.$queryRaw.mockResolvedValueOnce([{
      id: stale.id,
      status: 'SUCCEEDED',
      taskId: 'task-1',
      runId: null,
      mediaObjectId: 'media-1',
      data: { progress: 100, contentUrl: '/done.png' },
    }])

    const graph = await replaceCanvasDocumentInTransaction(tx as never, {
      projectId: 'project-1',
      canvasId: 'canvas-1',
      userId: 'user-1',
      input: { ...input(), nodes: [stale] },
    })

    expect(tx.$queryRaw).toHaveBeenCalledOnce()
    expect(tx.canvasNode.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { id: stale.id, canvasId: 'canvas-1', status: 'SUCCEEDED' },
      data: expect.objectContaining({ status: 'SUCCEEDED', mediaObjectId: 'media-1' }),
    }))
    expect(graph.nodes[0]).toMatchObject({
      status: 'SUCCEEDED',
      mediaObjectId: 'media-1',
      data: { prompt: '本地编辑', progress: 100, contentUrl: '/done.png' },
    })
    expect(tx.canvasSnapshot.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        document: expect.objectContaining({ nodes: [expect.objectContaining({ status: 'SUCCEEDED' })] }),
      }),
    }))
  })

  it('applies a scoped operation batch, increments once, and snapshots the final graph', async () => {
    const tx = transaction()
    tx.canvasNode.findMany.mockResolvedValueOnce([{
      ...input().nodes[0],
      canvasId: 'canvas-1',
    }])
    tx.canvasEdge.findMany.mockResolvedValueOnce([])

    const graph = await applyCanvasOperationsInTransaction(tx as never, {
      projectId: 'project-1',
      canvasId: 'canvas-1',
      userId: 'user-1',
      input: {
        expectedRevision: 5,
        clientId: 'tab-1',
        changeSummary: '移动并新增节点',
        ops: [
          { type: 'node.upsert', node: { ...input().nodes[0], position: { x: 90, y: 120 } } },
          { type: 'node.upsert', node: { ...input().nodes[0], id: 'node-2', position: { x: 400, y: 120 } } },
          {
            type: 'edge.add',
            edge: {
              id: 'edge-1',
              sourceNodeId: 'node-1',
              targetNodeId: 'node-2',
              sourceHandle: null,
              targetHandle: null,
              role: 'INPUT_DEFAULT',
            },
          },
          { type: 'canvas.update_meta', viewport: { x: 12, y: -4, zoom: 0.9 } },
        ],
      },
    })

    expect(tx.canvas.updateMany).toHaveBeenCalledWith({
      where: { id: 'canvas-1', projectId: 'project-1', revision: 5 },
      data: { revision: { increment: 1 }, viewport: { x: 12, y: -4, zoom: 0.9 } },
    })
    expect(tx.canvasNode.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'node-1', canvasId: 'canvas-1' },
    }))
    expect(tx.canvasNode.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ id: 'node-2', canvasId: 'canvas-1' }),
    }))
    expect(tx.canvasEdge.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ id: 'edge-1', canvasId: 'canvas-1' })],
    })
    expect(tx.canvasSnapshot.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ revision: 6, changeSummary: '移动并新增节点' }),
    }))
    expect(graph).toMatchObject({ canvas: { revision: 6 }, nodes: [{ id: 'node-1' }, { id: 'node-2' }] })
  })

  it('refuses a recovery or merge save that deletes a large part of the canvas, but not a deliberate edit', async () => {
    const stored = Array.from({ length: 100 }, (_, index) => ({ ...input().nodes[0], id: `n${index}`, canvasId: 'canvas-1' }))
    const deletions = stored.slice(0, 40).map((node) => ({ type: 'node.delete' as const, id: node.id }))
    const run = (changeSummary: string) => {
      const tx = transaction()
      tx.canvasNode.findMany.mockResolvedValueOnce(stored)
      tx.canvasEdge.findMany.mockResolvedValueOnce([])
      const result = applyCanvasOperationsInTransaction(tx as never, {
        projectId: 'project-1',
        canvasId: 'canvas-1',
        userId: 'user-1',
        input: { expectedRevision: 5, clientId: 'tab-1', changeSummary, ops: deletions },
      })
      return { tx, result }
    }

    const blocked = run('恢复本地未同步版本')
    await expect(blocked.result).rejects.toMatchObject({ code: 'CONFLICT', details: expect.objectContaining({ reason: 'CANVAS_BULK_REMOVAL_BLOCKED' }) })
    expect(blocked.tx.canvasNode.deleteMany).not.toHaveBeenCalled()

    const deliberate = run('编辑画布')
    await expect(deliberate.result).resolves.toBeDefined()
    expect(deliberate.tx.canvasNode.deleteMany).toHaveBeenCalled()
  })

  it('reports the actual revision when an operation batch loses the atomic claim', async () => {
    const tx = transaction(0)
    tx.canvas.findFirst.mockResolvedValueOnce({ revision: 9 })
    await expect(applyCanvasOperationsInTransaction(tx as never, {
      projectId: 'project-1',
      canvasId: 'canvas-1',
      userId: 'user-1',
      input: {
        expectedRevision: 5,
        clientId: 'tab-1',
        changeSummary: null,
        ops: [{ type: 'node.delete', id: 'node-1' }],
      },
    })).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { expectedRevision: 5, actualRevision: 9 },
    })
    expect(tx.canvasNode.deleteMany).not.toHaveBeenCalled()
  })

  it('re-reads a terminal node when reconciliation wins the ops update race', async () => {
    const tx = transaction()
    const stale = { ...input().nodes[0], status: 'RUNNING', taskId: 'task-1', data: { prompt: '移动后保留', progress: 10 } }
    tx.canvasNode.findMany.mockResolvedValueOnce([{ ...stale, canvasId: 'canvas-1' }])
    tx.canvasEdge.findMany.mockResolvedValueOnce([])
    tx.canvasNode.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 })
    tx.$queryRaw.mockResolvedValueOnce([{
      id: stale.id,
      status: 'FAILED',
      taskId: 'task-1',
      runId: null,
      mediaObjectId: null,
      data: { progress: 80, errorMessage: '生成失败' },
    }])

    const graph = await applyCanvasOperationsInTransaction(tx as never, {
      projectId: 'project-1',
      canvasId: 'canvas-1',
      userId: 'user-1',
      input: {
        expectedRevision: 5,
        clientId: 'tab-1',
        changeSummary: '移动运行中节点',
        ops: [{ type: 'node.upsert', node: { ...stale, position: { x: 600, y: 300 } } }],
      },
    })

    expect(tx.$queryRaw).toHaveBeenCalledOnce()
    expect(graph.nodes[0]).toMatchObject({
      position: { x: 600, y: 300 },
      status: 'FAILED',
      data: { prompt: '移动后保留', progress: 80, errorMessage: '生成失败' },
    })
    expect(tx.canvasSnapshot.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        document: expect.objectContaining({ nodes: [expect.objectContaining({ status: 'FAILED' })] }),
      }),
    }))
  })

  it('copies an independent studio document when a duplicated node is created', async () => {
    const tx = transaction()
    const source = {
      ...input().nodes[0],
      id: 'studio-source',
      type: 'studio_3d',
      canvasId: 'canvas-1',
      data: { title: '源导演台' },
    }
    const target = {
      ...input().nodes[0],
      id: 'studio-copy',
      type: 'studio_3d',
      data: {
        title: '源导演台',
        __studioDocumentSource: {
          kind: 'canvas-node',
          projectId: 'project-1',
          canvasId: 'canvas-1',
          nodeId: 'studio-source',
        },
      },
    }
    tx.canvasNode.findMany.mockResolvedValueOnce([source])
    tx.canvasEdge.findMany.mockResolvedValueOnce([])
    tx.canvasNode.findFirst.mockResolvedValueOnce(source)
    tx.canvasStudio3DDocument.findFirst.mockResolvedValueOnce({
      revision: 7,
      document: { ...DEFAULT_STUDIO_SCENE, backgroundColor: '#123456' },
    })

    const graph = await applyCanvasOperationsInTransaction(tx as never, {
      projectId: 'project-1',
      canvasId: 'canvas-1',
      userId: 'storyboard-user',
      templateOwnerId: 'workspace-owner',
      input: {
        expectedRevision: 5,
        clientId: 'tab-1',
        changeSummary: '创建副本',
        ops: [{ type: 'node.upsert', node: target }],
      },
    })

    expect(tx.canvas.findFirst).toHaveBeenCalledWith({
      where: { id: 'canvas-1', projectId: 'project-1' },
      select: { id: true },
    })
    expect(tx.canvasStudio3DDocument.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { projectId: 'project-1', canvasId: 'canvas-1', nodeId: 'studio-source' },
    }))
    expect(tx.canvasStudio3DDocument.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        projectId: 'project-1',
        canvasId: 'canvas-1',
        nodeId: 'studio-copy',
        revision: 1,
        updatedBy: 'storyboard-user',
        document: expect.objectContaining({ backgroundColor: '#123456' }),
      })],
    })
    expect(graph.nodes.find((node) => node.id === 'studio-copy')).toMatchObject({
      data: {
        __studioDocumentSource: {
          kind: 'canvas-node',
          projectId: 'project-1',
          canvasId: 'canvas-1',
          nodeId: 'studio-copy',
        },
      },
    })
  })

  it('restores the studio scene archived with a canvas history snapshot', async () => {
    const tx = transaction()
    const studioNode = {
      ...input().nodes[0],
      id: 'studio-1',
      type: 'studio_3d',
      data: { title: '导演台' },
    }
    tx.canvasNode.findMany.mockResolvedValueOnce([studioNode])
    tx.canvasStudio3DDocument.findMany
      .mockResolvedValueOnce([{ id: 'studio-document-1', nodeId: 'studio-1', revision: 11 }])
      .mockResolvedValueOnce([])

    await replaceCanvasDocumentInTransaction(tx as never, {
      projectId: 'project-1',
      canvasId: 'canvas-1',
      userId: 'storyboard-user',
      input: { ...input(), nodes: [studioNode] },
      studioDocumentRestore: [{
        nodeId: 'studio-1',
        revision: 4,
        document: { ...DEFAULT_STUDIO_SCENE, backgroundColor: '#654321' },
      }],
    })

    expect(tx.canvasStudio3DDocument.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'studio-document-1',
        projectId: 'project-1',
        canvasId: 'canvas-1',
        nodeId: 'studio-1',
        revision: 11,
      },
      data: {
        revision: { increment: 1 },
        document: expect.objectContaining({ backgroundColor: '#654321' }),
        updatedBy: 'storyboard-user',
      },
    })
  })

  it('deletes a studio node only through the scoped node row so its document cascades safely', async () => {
    const tx = transaction()
    const studioNode = {
      ...input().nodes[0],
      id: 'studio-1',
      type: 'studio_3d',
      canvasId: 'canvas-1',
      data: { title: '导演台' },
    }
    tx.canvasNode.findMany.mockResolvedValueOnce([studioNode])
    tx.canvasEdge.findMany.mockResolvedValueOnce([])

    await applyCanvasOperationsInTransaction(tx as never, {
      projectId: 'project-1',
      canvasId: 'canvas-1',
      userId: 'storyboard-user',
      input: {
        expectedRevision: 5,
        clientId: 'tab-1',
        changeSummary: '删除节点',
        ops: [{ type: 'node.delete', id: 'studio-1' }],
      },
    })

    expect(tx.canvasNode.deleteMany).toHaveBeenCalledWith({
      where: { canvasId: 'canvas-1', id: { in: ['studio-1'] } },
    })
    expect(tx.canvasStudio3DDocument.deleteMany).not.toHaveBeenCalled()
  })
})

describe('metadata-only operation batches', () => {
  const viewportOnly = {
    expectedRevision: 5,
    clientId: 'tab-1',
    changeSummary: '调整画布视图',
    ops: [{ type: 'canvas.update_meta' as const, viewport: { x: 40, y: -8, zoom: 0.5 } }],
  }
  const args = { projectId: 'project-1', canvasId: 'canvas-1', userId: 'user-1' }

  it('skips every node and edge read for a delta client when no snapshot is due', async () => {
    const tx = transaction()
    tx.canvasSnapshot.findFirst.mockResolvedValueOnce({ createdAt: new Date() })

    const result = await applyCanvasOperationsInTransaction(tx as never, { ...args, input: viewportOnly, deltaOnly: true })

    expect(tx.canvas.updateMany).toHaveBeenCalledWith({
      where: { id: 'canvas-1', projectId: 'project-1', revision: 5 },
      data: { revision: { increment: 1 }, viewport: { x: 40, y: -8, zoom: 0.5 } },
    })
    expect(tx.canvasNode.findMany).not.toHaveBeenCalled()
    expect(tx.canvasEdge.findMany).not.toHaveBeenCalled()
    expect(tx.canvasNode.updateMany).not.toHaveBeenCalled()
    expect(tx.canvasSnapshot.create).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      canvas: { revision: 6 },
      delta: { nodes: [], edges: [], deletedNodeIds: [], deletedEdgeIds: [] },
    })
    expect('nodes' in result).toBe(false)
  })

  it('still records the graph snapshot when one is due', async () => {
    const tx = transaction()
    tx.canvasNode.findMany.mockResolvedValueOnce([{ ...input().nodes[0], canvasId: 'canvas-1' }])

    const result = await applyCanvasOperationsInTransaction(tx as never, { ...args, input: viewportOnly, deltaOnly: true })

    expect(tx.canvasNode.findMany).toHaveBeenCalledOnce()
    expect(tx.canvasSnapshot.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        revision: 6,
        document: expect.objectContaining({ nodes: [expect.objectContaining({ id: 'node-1' })] }),
      }),
    }))
    expect(result.delta.nodes).toEqual([])
  })

  it('keeps the full graph read when the batch also writes entities', async () => {
    const tx = transaction()
    tx.canvasSnapshot.findFirst.mockResolvedValueOnce({ createdAt: new Date() })
    tx.canvasNode.findMany.mockResolvedValueOnce([{ ...input().nodes[0], canvasId: 'canvas-1' }])

    const result = await applyCanvasOperationsInTransaction(tx as never, {
      ...args,
      deltaOnly: true,
      input: { ...viewportOnly, ops: [{ type: 'node.delete', id: 'node-1' }, ...viewportOnly.ops] },
    })

    expect(tx.canvasNode.findMany).toHaveBeenCalledOnce()
    expect(tx.canvasEdge.findMany).toHaveBeenCalledOnce()
    expect(result.delta.deletedNodeIds).toEqual(['node-1'])
  })

  it('returns the full graph to a client that did not opt into deltas', async () => {
    const tx = transaction()
    tx.canvasSnapshot.findFirst.mockResolvedValueOnce({ createdAt: new Date() })
    tx.canvasNode.findMany.mockResolvedValueOnce([{ ...input().nodes[0], canvasId: 'canvas-1' }])

    const result = await applyCanvasOperationsInTransaction(tx as never, { ...args, input: viewportOnly })

    expect(tx.canvasNode.findMany).toHaveBeenCalledOnce()
    expect(result.nodes).toHaveLength(1)
  })

  it('does not apply a metadata-only batch after losing the revision claim', async () => {
    const tx = transaction(0)
    tx.canvas.findFirst.mockResolvedValueOnce({ revision: 9 })

    await expect(applyCanvasOperationsInTransaction(tx as never, { ...args, input: viewportOnly, deltaOnly: true }))
      .rejects.toMatchObject({ code: 'CONFLICT', details: { expectedRevision: 5, actualRevision: 9 } })
    expect(tx.canvasSnapshot.findFirst).not.toHaveBeenCalled()
  })
})
